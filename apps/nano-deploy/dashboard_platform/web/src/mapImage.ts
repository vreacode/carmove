export function pgmArrayBufferToDataUrl(buffer: ArrayBuffer, expected?: { width?: number | null; height?: number | null }): string {
  const bytes = new Uint8Array(buffer);
  const { width, height, data } = parsePgm(bytes);
  if ((expected?.width != null && expected.width !== width) || (expected?.height != null && expected.height !== height)) throw new Error("地图图片与尺寸信息不一致，请重新加载。");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("canvas 2d context is unavailable");
  }
  const image = ctx.createImageData(width, height);
  for (let index = 0; index < data.length; index += 1) {
    const value = data[index];
    const offset = index * 4;
    image.data[offset] = value;
    image.data[offset + 1] = value;
    image.data[offset + 2] = value;
    image.data[offset + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}


/** P5 has exactly one header separator; subsequent whitespace-valued bytes are pixels. */
export function parsePgm(bytes: Uint8Array): { width: number; height: number; data: Uint8Array } {
  let offset = 0;
  const whitespace = (value: number) => value === 9 || value === 10 || value === 11 || value === 12 || value === 13 || value === 32;
  const readToken = () => {
    while (offset < bytes.length) {
      if (bytes[offset] === 35) {
        while (offset < bytes.length && bytes[offset] !== 10) offset++;
      } else if (whitespace(bytes[offset])) offset++;
      else break;
    }
    const start = offset;
    while (offset < bytes.length && !whitespace(bytes[offset]) && bytes[offset] !== 35) offset++;
    return new TextDecoder().decode(bytes.subarray(start, offset));
  };
  const magic = readToken();
  const width = Number(readToken()), height = Number(readToken()), maxValue = Number(readToken());
  const pixels = width * height;
  if (![width, height, maxValue].every((n) => Number.isInteger(n) && n > 0) || maxValue > 65535 || !Number.isSafeInteger(pixels) || pixels > 64 * 1024 * 1024) {
    throw new Error("PGM 地图尺寸或像素范围无效。");
  }
  let data: Uint8Array;
  if (magic === "P5") {
    if (!whitespace(bytes[offset])) throw new Error("PGM 地图头部不完整。");
    offset += bytes[offset] === 13 && bytes[offset + 1] === 10 ? 2 : 1;
    const stride = maxValue > 255 ? 2 : 1;
    if (bytes.length - offset < pixels * stride) throw new Error("PGM 地图像素数据不完整。");
    if (maxValue === 255) return { width, height, data: bytes.subarray(offset, offset + pixels) };
    data = new Uint8Array(pixels);
    for (let i = 0; i < pixels; i++) {
      const at = offset + i * stride;
      const value = stride === 2 ? bytes[at] * 256 + bytes[at + 1] : bytes[at];
      if (value > maxValue) throw new Error("PGM 地图像素超出范围。");
      data[i] = Math.round(value / maxValue * 255);
    }
  } else if (magic === "P2") {
    data = new Uint8Array(pixels);
    for (let i = 0; i < pixels; i++) {
      const token = readToken(), value = Number(token);
      if (!token || !Number.isInteger(value) || value < 0 || value > maxValue) throw new Error("PGM 地图像素数据无效。");
      data[i] = Math.round(value / maxValue * 255);
    }
  } else throw new Error("不支持的地图格式，请使用 PGM P2 或 P5。");
  return { width, height, data };
}
