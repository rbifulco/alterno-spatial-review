import * as THREE from "three";

export type TextureResource = { bytes: ArrayBuffer; contentType: string };

function sourceReference(texture: THREE.Texture) {
  const image = texture.source?.data as { src?: string; currentSrc?: string } | undefined;
  return typeof texture.userData.sourceRef === "string"
    ? texture.userData.sourceRef
    : typeof texture.userData.requestUrl === "string"
      ? texture.userData.requestUrl
      : image?.currentSrc || image?.src;
}

function canvasBlob(canvas: HTMLCanvasElement, contentType = "image/png") {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("The texture canvas could not be encoded.")),
    contentType,
  ));
}

async function drawableBlob(image: CanvasImageSource, width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("A 2D canvas is unavailable for texture export.");
  context.drawImage(image, 0, 0, width, height);
  return canvasBlob(canvas);
}

function imageBlob(blob: Blob, source: string) {
  if (!blob.type.toLowerCase().startsWith("image/")) {
    throw new Error(`${source} has non-image Content-Type ${JSON.stringify(blob.type || "(missing)")}.`);
  }
  return blob;
}

function dataTextureBlob(data: { data?: unknown; width?: unknown; height?: unknown }) {
  const width = Number(data.width);
  const height = Number(data.height);
  const values = data.data;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || (!(values instanceof Uint8Array) && !(values instanceof Uint8ClampedArray))) return undefined;
  const source = new Uint8ClampedArray(values.buffer, values.byteOffset, values.byteLength);
  let rgba: Uint8ClampedArray<ArrayBuffer>;
  if (source.length === width * height * 4) {
    rgba = new Uint8ClampedArray(new ArrayBuffer(source.byteLength));
    rgba.set(source);
  }
  else if (source.length === width * height * 3) {
    rgba = new Uint8ClampedArray(new ArrayBuffer(width * height * 4));
    for (let sourceIndex = 0, targetIndex = 0; sourceIndex < source.length; sourceIndex += 3, targetIndex += 4) {
      rgba[targetIndex] = source[sourceIndex];
      rgba[targetIndex + 1] = source[sourceIndex + 1];
      rgba[targetIndex + 2] = source[sourceIndex + 2];
      rgba[targetIndex + 3] = 255;
    }
  } else return undefined;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return undefined;
  context.putImageData(new ImageData(rgba, width, height), 0, 0);
  return canvasBlob(canvas);
}

async function decodedTextureBlob(texture: THREE.Texture) {
  const image = texture.source?.data;
  if (image instanceof Blob) return imageBlob(image, "The decoded texture Blob");
  if (typeof HTMLCanvasElement !== "undefined" && image instanceof HTMLCanvasElement) return canvasBlob(image);
  if (typeof OffscreenCanvas !== "undefined" && image instanceof OffscreenCanvas) return image.convertToBlob({ type: "image/png" });
  if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) return drawableBlob(image, image.width, image.height);
  if (typeof HTMLImageElement !== "undefined" && image instanceof HTMLImageElement && image.naturalWidth && image.naturalHeight) return drawableBlob(image, image.naturalWidth, image.naturalHeight);
  if (typeof HTMLVideoElement !== "undefined" && image instanceof HTMLVideoElement && image.videoWidth && image.videoHeight) return drawableBlob(image, image.videoWidth, image.videoHeight);
  const dataBlob = image && typeof image === "object" ? dataTextureBlob(image as { data?: unknown; width?: unknown; height?: unknown }) : undefined;
  if (dataBlob) return dataBlob;
  throw new Error("The texture has no exportable image source.");
}

async function textureBlob(texture: THREE.Texture) {
  const annotated = texture.userData.sourceBlob;
  if (annotated instanceof Blob) return imageBlob(annotated, "The annotated texture Blob");
  const sourceRef = sourceReference(texture);
  if (!sourceRef) return decodedTextureBlob(texture);

  const response = await fetch(new URL(sourceRef, typeof document === "undefined" ? "http://localhost/" : document.baseURI));
  if (!response.ok) throw new Error(`Texture source returned ${response.status}.`);
  const blob = await response.blob();
  if (blob.type.toLowerCase().startsWith("image/")) return blob;

  try {
    return await decodedTextureBlob(texture);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "The decoded texture could not be exported.";
    throw new Error(
      `Texture source returned non-image Content-Type ${JSON.stringify(blob.type || "(missing)")}, and its decoded fallback is unavailable: ${reason} Configure the source response with an image/* Content-Type or provide an exportable decoded image source.`,
    );
  }
}

export async function readTextureResource(texture: THREE.Texture, maxBytes: number): Promise<TextureResource> {
  const blob = await textureBlob(texture);
  if (blob.size > maxBytes) throw new RangeError(`Texture exceeds the ${Math.floor(maxBytes / 1024 / 1024)} MB transfer limit.`);
  return { bytes: await blob.arrayBuffer(), contentType: blob.type || "image/png" };
}
