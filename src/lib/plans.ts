/** Paket sewa bot (harga dalam Rupiah). */
export interface BotPlan {
  id: string;
  label: string;
  days: number;
  price: number;
  note?: string;
}

export const BOT_PLANS: BotPlan[] = [
  { id: 'harian', label: 'Harian', days: 1, price: 3_000, note: '1 hari penuh' },
  { id: 'mingguan', label: 'Mingguan', days: 7, price: 17_500, note: 'Hemat 7%' },
  { id: 'bulanan', label: 'Bulanan', days: 30, price: 20_000, note: 'Paling hemat' },
];

export function getPlan(id: string): BotPlan | undefined {
  return BOT_PLANS.find((p) => p.id === id);
}

/** Harga per hari untuk paket custom. */
export const PRICE_PER_DAY = 3_000;

/** Hitung harga untuk jumlah hari yang diminta (pakai paket termurah yang pas). */
export function priceForDays(days: number): number {
  if (days <= 0) return 0;
  const bulanan = BOT_PLANS.find((p) => p.id === 'bulanan')!;
  const mingguan = BOT_PLANS.find((p) => p.id === 'mingguan')!;
  const bulan = Math.floor(days / 30);
  const sisaSetelahBulan = days % 30;
  const minggu = Math.floor(sisaSetelahBulan / 7);
  const sisaHari = sisaSetelahBulan % 7;
  return bulan * bulanan.price + minggu * mingguan.price + sisaHari * PRICE_PER_DAY;
}
