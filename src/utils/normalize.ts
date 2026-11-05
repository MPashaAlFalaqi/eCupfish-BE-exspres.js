export function normalizePhone(nilai: string): string {
  let p = nilai.replace(/[\s-]/g, '');
  if (p.startsWith('+62')) p = '0' + p.slice(3);
  else if (p.startsWith('62')) p = '0' + p.slice(2);
  return p;
}

// Email diubah ke huruf kecil, nomor HP diseragamkan
export function normalizeTarget(nilai: string): string {
  const v = nilai.trim();
  return v.includes('@') ? v.toLowerCase() : normalizePhone(v);
}