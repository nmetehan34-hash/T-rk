// Supabase panelinde: Project Settings > API (veya "Connect") bölümündeki değerleri buraya yapıştır.
// Bu anahtar tarayıcıda görünmek üzere tasarlanmıştır; güvenliği veritabanı kuralları sağlar.
// "service_role" / "secret" anahtarını ASLA buraya koyma.
window.ATS_CONFIG = {
  SUPABASE_URL: 'https://PROJE-ADRESIN.supabase.co',
  SUPABASE_ANON_KEY: 'ANON-VEYA-PUBLISHABLE-KEY-BURAYA'
};
