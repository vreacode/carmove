#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <stdexcept>
#include <string>

#include "rclcpp/rclcpp.hpp"
#include "sensor_msgs/msg/point_cloud2.hpp"
#include "sensor_msgs/point_cloud2_iterator.hpp"

namespace
{

bool has_field(
  const sensor_msgs::msg::PointCloud2 & cloud,
  const std::string & name,
  const std::uint8_t datatype)
{
  return std::any_of(
    cloud.fields.begin(), cloud.fields.end(),
    [&name, datatype](const sensor_msgs::msg::PointField & field) {
      return field.name == name && field.datatype == datatype && field.count == 1;
    });
}

}  // namespace

class HesaiFastlioAdapter final : public rclcpp::Node
{
public:
  HesaiFastlioAdapter()
  : Node("hesai_fastlio_adapter")
  {
    input_topic_ = declare_parameter<std::string>("input_topic", "/lidar_points");
    output_topic_ = declare_parameter<std::string>("output_topic", "/lidar_points_fastlio");
    max_scan_duration_sec_ = declare_parameter<double>("max_scan_duration_sec", 0.2);
    header_tolerance_sec_ = declare_parameter<double>("header_tolerance_sec", 0.02);
    point_stride_per_ring_ = declare_parameter<int>("point_stride_per_ring", 4);

    if (
      max_scan_duration_sec_ <= 0.0 || header_tolerance_sec_ < 0.0 ||
      point_stride_per_ring_ < 1)
    {
      throw std::invalid_argument("duration and timestamp tolerance parameters must be positive");
    }

    publisher_ = create_publisher<sensor_msgs::msg::PointCloud2>(
      output_topic_, rclcpp::SensorDataQoS());
    subscription_ = create_subscription<sensor_msgs::msg::PointCloud2>(
      input_topic_, rclcpp::SensorDataQoS(),
      std::bind(&HesaiFastlioAdapter::convert, this, std::placeholders::_1));

    RCLCPP_INFO(
      get_logger(), "Hesai FAST-LIO adapter ready: %s -> %s, per-ring stride=%d",
      input_topic_.c_str(), output_topic_.c_str(), point_stride_per_ring_);
  }

private:
  void convert(const sensor_msgs::msg::PointCloud2::ConstSharedPtr input)
  {
    if (!validate_layout(*input)) {
      RCLCPP_ERROR_THROTTLE(
        get_logger(), *get_clock(), 5000,
        "Input cloud must contain x/y/z/intensity FLOAT32, ring UINT16 and timestamp FLOAT64");
      return;
    }
    if (input->width == 0 || input->height == 0) {
      return;
    }

    sensor_msgs::PointCloud2ConstIterator<float> in_x(*input, "x");
    sensor_msgs::PointCloud2ConstIterator<float> in_y(*input, "y");
    sensor_msgs::PointCloud2ConstIterator<float> in_z(*input, "z");
    sensor_msgs::PointCloud2ConstIterator<float> in_intensity(*input, "intensity");
    sensor_msgs::PointCloud2ConstIterator<std::uint16_t> in_ring(*input, "ring");
    sensor_msgs::PointCloud2ConstIterator<double> in_timestamp(*input, "timestamp");

    const double first_timestamp = *in_timestamp;
    if (!std::isfinite(first_timestamp)) {
      RCLCPP_WARN_THROTTLE(
        get_logger(), *get_clock(), 5000, "Discarding cloud with invalid first-point timestamp");
      return;
    }

    const double header_timestamp =
      static_cast<double>(input->header.stamp.sec) +
      static_cast<double>(input->header.stamp.nanosec) * 1.0e-9;
    if (std::abs(header_timestamp - first_timestamp) > header_tolerance_sec_) {
      RCLCPP_WARN_THROTTLE(
        get_logger(), *get_clock(), 5000,
        "Point-cloud header differs from first point by %.3f ms",
        (header_timestamp - first_timestamp) * 1000.0);
    }

    sensor_msgs::msg::PointCloud2 output;
    output.header = input->header;
    output.height = input->height;
    output.width = input->width;
    output.is_bigendian = false;
    output.is_dense = input->is_dense;

    sensor_msgs::PointCloud2Modifier modifier(output);
    modifier.setPointCloud2Fields(
      6,
      "x", 1, sensor_msgs::msg::PointField::FLOAT32,
      "y", 1, sensor_msgs::msg::PointField::FLOAT32,
      "z", 1, sensor_msgs::msg::PointField::FLOAT32,
      "intensity", 1, sensor_msgs::msg::PointField::FLOAT32,
      "time", 1, sensor_msgs::msg::PointField::FLOAT32,
      "ring", 1, sensor_msgs::msg::PointField::UINT16);
    modifier.resize(static_cast<std::size_t>(input->width) * input->height);

    sensor_msgs::PointCloud2Iterator<float> out_x(output, "x");
    sensor_msgs::PointCloud2Iterator<float> out_y(output, "y");
    sensor_msgs::PointCloud2Iterator<float> out_z(output, "z");
    sensor_msgs::PointCloud2Iterator<float> out_intensity(output, "intensity");
    sensor_msgs::PointCloud2Iterator<float> out_time(output, "time");
    sensor_msgs::PointCloud2Iterator<std::uint16_t> out_ring(output, "ring");

    double previous_timestamp = first_timestamp;
    double final_offset = 0.0;
    std::array<std::uint32_t, 256> ring_counters{};
    std::size_t selected_count = 0;
    const std::size_t point_count = static_cast<std::size_t>(input->width) * input->height;
    for (std::size_t index = 0; index < point_count; ++index) {
      const double timestamp = *in_timestamp;
      const double offset = timestamp - first_timestamp;
      if (!std::isfinite(timestamp) || timestamp + 1.0e-9 < previous_timestamp ||
        offset < -1.0e-9 || offset > max_scan_duration_sec_)
      {
        RCLCPP_WARN_THROTTLE(
          get_logger(), *get_clock(), 5000,
          "Discarding cloud with non-monotonic or out-of-range point timestamps");
        return;
      }

      const std::uint16_t ring = *in_ring;
      if (ring >= ring_counters.size()) {
        RCLCPP_WARN_THROTTLE(
          get_logger(), *get_clock(), 5000, "Discarding cloud with ring index above 255");
        return;
      }
      const bool keep = (ring_counters[ring]++ % point_stride_per_ring_) == 0;
      if (keep) {
        *out_x = *in_x;
        *out_y = *in_y;
        *out_z = *in_z;
        *out_intensity = *in_intensity;
        *out_time = static_cast<float>(std::max(0.0, offset));
        *out_ring = ring;
        ++out_x;
        ++out_y;
        ++out_z;
        ++out_intensity;
        ++out_time;
        ++out_ring;
        ++selected_count;
      }

      previous_timestamp = timestamp;
      final_offset = offset;
      ++in_x;
      ++in_y;
      ++in_z;
      ++in_intensity;
      ++in_ring;
      ++in_timestamp;
    }

    modifier.resize(selected_count);
    publisher_->publish(output);
    frame_count_ += 1;
    if (frame_count_ == 1) {
      RCLCPP_INFO(
        get_logger(), "First adapted frame: %zu/%zu points, %.3f ms span, frame=%s",
        selected_count, point_count, final_offset * 1000.0, output.header.frame_id.c_str());
    }
  }

  bool validate_layout(const sensor_msgs::msg::PointCloud2 & cloud) const
  {
    using sensor_msgs::msg::PointField;
    return has_field(cloud, "x", PointField::FLOAT32) &&
           has_field(cloud, "y", PointField::FLOAT32) &&
           has_field(cloud, "z", PointField::FLOAT32) &&
           has_field(cloud, "intensity", PointField::FLOAT32) &&
           has_field(cloud, "ring", PointField::UINT16) &&
           has_field(cloud, "timestamp", PointField::FLOAT64);
  }

  std::string input_topic_;
  std::string output_topic_;
  double max_scan_duration_sec_;
  double header_tolerance_sec_;
  int point_stride_per_ring_;
  std::uint64_t frame_count_{0};
  rclcpp::Publisher<sensor_msgs::msg::PointCloud2>::SharedPtr publisher_;
  rclcpp::Subscription<sensor_msgs::msg::PointCloud2>::SharedPtr subscription_;
};

int main(int argc, char ** argv)
{
  rclcpp::init(argc, argv);
  rclcpp::spin(std::make_shared<HesaiFastlioAdapter>());
  rclcpp::shutdown();
  return 0;
}
