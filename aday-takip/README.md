# Aday Takip Sistemi

Yüz yüze, online ya da telefonla görüşülen adayları; CV'leri, görüşme notları ve referans görüşmeleriyle birlikte tutan web uygulaması. Veriler Supabase'de saklanır, uygulama her bilgisayardan tarayıcıyla açılır.

## Klasörler

- `web/`: uygulamanın kendisi (Netlify bu klasörü yayınlar)
- `supabase-kurulum.sql`: veritabanı tabloları, erişim kuralları ve CV klasörü

## Kurulum

### 1. Supabase projesi
1. [supabase.com](https://supabase.com) üzerinden ücretsiz hesap aç, **New project** ile proje oluştur. Bölge olarak Avrupa'yı (ör. Frankfurt) seçebilirsin.
2. Soldan **SQL Editor > New query** aç, `supabase-kurulum.sql` dosyasının tamamını yapıştır, **Run** de.

### 2. Dışarıdan kaydı kapat (önemli)
**Authentication > Sign In / Providers** bölümünde **Allow new users to sign up** seçeneğini kapat. Böylece siteyi bulan biri kendine hesap açamaz; kullanıcıları sadece sen eklersin.

### 3. Kullanıcıları ekle
**Authentication > Users > Add user > Create new user**: e-posta ve şifre gir, **Auto Confirm User** işaretli olsun. Her ekip üyesi için tekrarla. Şifre sıfırlamak için de aynı ekranı kullanabilirsin.

### 4. Uygulamayı projeye bağla
**Project Settings > API** (ya da üstteki **Connect** butonu) ekranından:
- **Project URL**
- **anon / publishable** anahtarı

değerlerini `web/config.js` dosyasına yaz. `service_role` / `secret` anahtarını asla bu dosyaya koyma.

### 5. Netlify'da yayınla
1. [netlify.com](https://netlify.com) üzerinden GitHub hesabınla giriş yap.
2. **Add new site > Import an existing project > GitHub** ile bu repoyu ve dalı seç.
3. Ayarlar `netlify.toml` dosyasından otomatik gelir; **Deploy** de.
4. Verilen adresi (ör. `https://aday-takip-xyz.netlify.app`) ekibinle paylaş.

## Notlar
- **Excel'e Aktar** (aday listesinin üstünde) tüm adayları ve referans görüşmelerini iki sayfalık bir `.xlsx` dosyasına indirir.
- **Analiz** ekranı departman, pozisyon ve tarih aralığına göre aday sayılarını, ücret beklentisi ortalama/medyan/aralığını, teklifleri ve işe alım oranını gösterir.
- Ücretler aylık net TL olarak, tam sayı şeklinde tutulur.
- Tüm kullanıcılar tüm adayları görür ve düzenleyebilir. Her kayıtta ekleyen kişinin e-postası tutulur.
- CV'ler gizli bir klasörde durur, sadece giriş yapmış kullanıcılar açabilir. PDF'ler sayfada önizlenir, Word dosyaları indirilir.
- Aday bilgileri kişisel veri sayılır (KVKK). Ekip dışına erişim vermemeye ve ayrılan çalışanların hesabını silmeye dikkat et.
- Ücretsiz Supabase projeleri 1 hafta hiç kullanılmazsa duraklatılır. Panelden tek tıkla yeniden başlatılabilir, veriler kaybolmaz.
