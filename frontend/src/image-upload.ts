export async function prepareImage(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 8_000_000)
    throw new Error("PNG / JPEG / WebP, ≤ 8 MB")
  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error("Image read failed"))
    reader.readAsDataURL(file)
  })
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error("Image decode failed"))
    image.src = source
  })
  if (Math.min(img.width, img.height) < 240 || img.width * img.height > 40_000_000)
    throw new Error("240 px minimum / 40 MP maximum")
  const scale = Math.min(1, 960 / Math.max(img.width, img.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  if (Math.min(canvas.width, canvas.height) < 240)
    throw new Error("Image is too narrow / Изображение слишком узкое")
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas unavailable")
  ctx.fillStyle = "#101713"
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  for (const quality of [0.88, 0.76, 0.6]) {
    const data = canvas.toDataURL("image/jpeg", quality)
    if (data.length < 390_000) return data
  }
  throw new Error("Choose a smaller image / Выберите менее детальное изображение")
}
