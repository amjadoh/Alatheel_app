export async function prepareHorsePhoto(file: File) {
  if (
    !/^image\/(jpeg|png|webp)$/.test(file.type) ||
    file.size > 12 * 1024 * 1024
  )
    throw new Error("اختر صورة JPG أو PNG أو WebP بحجم أقل من 12 ميجابايت");
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("تعذر قراءة الصورة"));
      img.src = url;
    });
    const scale = Math.min(
      1,
      960 / Math.max(img.naturalWidth, img.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("تعذر تجهيز الصورة");
    ctx.fillStyle = "#f5f1e7";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let result = "";
    for (const quality of [0.82, 0.65, 0.45, 0.25]) {
      result = canvas.toDataURL("image/jpeg", quality);
      if (result.length <= 260000) return result;
    }
    throw new Error("الصورة كبيرة بعد التجهيز؛ اختر صورة أصغر");
  } finally {
    URL.revokeObjectURL(url);
  }
}
