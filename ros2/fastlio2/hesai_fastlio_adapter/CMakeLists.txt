cmake_minimum_required(VERSION 3.8)
project(hesai_fastlio_adapter)

if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

find_package(ament_cmake REQUIRED)
find_package(rclcpp REQUIRED)
find_package(sensor_msgs REQUIRED)

add_executable(hesai_fastlio_adapter_node src/hesai_fastlio_adapter_node.cpp)
target_compile_features(hesai_fastlio_adapter_node PUBLIC cxx_std_17)
ament_target_dependencies(hesai_fastlio_adapter_node rclcpp sensor_msgs)

install(
  TARGETS hesai_fastlio_adapter_node
  DESTINATION lib/${PROJECT_NAME}
)

ament_package()
