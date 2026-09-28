(function () {
  'use strict';

  const cfg = window.ATS_CONFIG || {};
  const ayarli = Boolean(
    cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
    !cfg.SUPABASE_URL.includes('PROJE-ADRESIN') && !cfg.SUPABASE_ANON_KEY.includes('BURAYA')
  );

  const GORUSME_TURLERI = { yuz_yuze: 'Yüz yüze', online: 'Online', telefon: 'Telefon' };
  const DURUMLAR = { beklemede: 'Beklemede', olumlu: 'Olumlu', olumsuz: 'Olumsuz', ise_alindi: 'İşe Alındı' };
  const CV_BUCKET = 'cvler';
  const MAKS_CV_MB = 10;
  const CV_TURLERI = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  };
  const KOLONLAR = [
    ['ad_soyad', 'Ad Soyad'],
    ['pozisyon', 'Pozisyon'],
    ['departman', 'Departman'],
    ['telefon', 'Telefon'],
    ['gorusme_tarihi', 'Görüşme Tarihi'],
    ['gorusme_turu', 'Görüşme Türü'],
    ['durum', 'Durum']
  ];
  const SEKMELER = [
    ['genel', 'Genel Bilgiler'],
    ['notlar', 'Görüşme Notları'],
    ['ucret', 'Ücret'],
    ['cv', 'CV'],
    ['referanslar', 'Referans Görüşmeleri']
  ];

  const el = {
    ayarEksik: document.getElementById('ayarEksik'),
    giris: document.getElementById('giris'),
    girisFormu: document.getElementById('girisFormu'),
    girisHata: document.getElementById('girisHata'),
    uygulama: document.getElementById('uygulama'),
    kullaniciEmail: document.getElementById('kullaniciEmail'),
    cikisBtn: document.getElementById('cikisBtn'),
    icerik: document.getElementById('icerik'),
    bildirim: document.getElementById('bildirim'),
    ipucu: document.getElementById('ipucu')
  };
  const EXCELJS_URL = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
  const SAYFA_BOYUTU = 1000;
  const MAKS_UCRET = 100000000;

  let sb = null;
  let kullanici = null;
  let gorunumNo = 0;
  let adaylar = [];
  let cvUrl = null;
  const liste = { arama: '', departman: '', tur: '', durum: '', alan: 'gorusme_tarihi', yon: -1 };
  const analiz = { departman: '', pozisyon: '', baslangic: '', bitis: '' };

  // ---------- yardımcılar ----------

  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function tarih(d) {
    if (!d) return '—';
    const [y, m, g] = String(d).slice(0, 10).split('-');
    return `${g}.${m}.${y}`;
  }

  function zaman(ts) {
    return ts ? new Date(ts).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  }

  function bugun() {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  function bosIseNull(v) {
    const t = String(v ?? '').trim();
    return t === '' ? null : t;
  }

  const sayiBicimi = new Intl.NumberFormat('tr-TR');

  function para(n) {
    return n == null ? '—' : sayiBicimi.format(Math.round(n)) + ' ₺';
  }

  function paraOku(v) {
    const rakamlar = String(v ?? '').split(',')[0].replace(/\D/g, '');
    return rakamlar === '' ? null : Number(rakamlar);
  }

  function paraAlaniBicimle(input) {
    const n = paraOku(input.value);
    input.value = n == null ? '' : sayiBicimi.format(n);
  }

  async function tumunuGetir(tablo, kolonlar) {
    let hepsi = [];
    for (let bas = 0; ; bas += SAYFA_BOYUTU) {
      const { data, error } = await sb.from(tablo).select(kolonlar)
        .order('olusturma_tarihi', { ascending: false }).order('id')
        .range(bas, bas + SAYFA_BOYUTU - 1);
      if (error) return { data: null, error };
      hepsi = hepsi.concat(data || []);
      if (!data || data.length < SAYFA_BOYUTU) return { data: hepsi, error: null };
    }
  }

  function uzanti(ad) {
    const i = ad.lastIndexOf('.');
    return i === -1 ? '' : ad.slice(i + 1).toLowerCase();
  }

  function secenekler(harita, secili, bosEtiket) {
    const bos = bosEtiket !== undefined ? `<option value="">${esc(bosEtiket)}</option>` : '';
    return bos + Object.entries(harita)
      .map(([k, v]) => `<option value="${esc(k)}"${k === secili ? ' selected' : ''}>${esc(v)}</option>`)
      .join('');
  }

  function benzersiz(kayitlar, alan) {
    return [...new Set(kayitlar.map(k => k[alan]).filter(Boolean))].sort((x, y) => x.localeCompare(y, 'tr'));
  }

  function durumRozeti(d) {
    return `<span class="rozet durum-${esc(d)}">${esc(DURUMLAR[d] || d)}</span>`;
  }

  function hataMetni(err) {
    const m = (err && (err.message || err.error_description || err.error)) || String(err);
    if (/failed to fetch|networkerror|load failed/i.test(m)) return 'Sunucuya ulaşılamadı. İnternet bağlantını kontrol et.';
    if (/jwt expired|invalid jwt/i.test(m)) return 'Oturum süresi doldu, lütfen tekrar giriş yap.';
    if (/maximum allowed size|payload too large/i.test(m)) return `Dosya çok büyük (en fazla ${MAKS_CV_MB} MB).`;
    if (/mime type/i.test(m)) return 'Bu dosya türü desteklenmiyor. Sadece PDF veya Word (.docx) yükleyebilirsin.';
    return m;
  }

  let bildirimZamani;
  function bildir(mesaj, tur) {
    el.bildirim.textContent = mesaj;
    el.bildirim.className = 'bildirim' + (tur ? ' tur-' + tur : '');
    el.bildirim.hidden = false;
    clearTimeout(bildirimZamani);
    bildirimZamani = setTimeout(() => { el.bildirim.hidden = true; }, tur === 'hata' ? 6000 : 3500);
  }

  function yeniGorunum(html) {
    el.ipucu.hidden = true;
    if (cvUrl) {
      URL.revokeObjectURL(cvUrl);
      cvUrl = null;
    }
    el.icerik.innerHTML = html;
    window.scrollTo(0, 0);
    return ++gorunumNo;
  }

  function guncelMi(no) {
    return no === gorunumNo;
  }

  function hataGorunumu(err) {
    el.icerik.innerHTML = `
      <div class="kart">
        <p class="hata">Bir hata oluştu: ${esc(hataMetni(err))}</p>
        <p><button type="button" class="btn" id="tekrarDeneBtn">Tekrar dene</button></p>
      </div>`;
    document.getElementById('tekrarDeneBtn').addEventListener('click', yonlendir);
  }

  function bulunamadi() {
    el.icerik.innerHTML = '<div class="kart"><p class="bos">Aday bulunamadı. Silinmiş olabilir. <a href="#/">Listeye dön</a></p></div>';
  }

  // ---------- oturum ----------

  function baslat() {
    if (!ayarli) {
      el.ayarEksik.hidden = false;
      return;
    }
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    // Supabase, bu callback içinde doğrudan sorgu atılmamasını öneriyor; o yüzden bir sonraki tura erteliyoruz.
    sb.auth.onAuthStateChange((_olay, oturum) => {
      setTimeout(() => oturumDegisti(oturum), 0);
    });
    el.girisFormu.addEventListener('submit', girisYap);
    el.cikisBtn.addEventListener('click', () => sb.auth.signOut());
    window.addEventListener('hashchange', yonlendir);
    window.addEventListener('scroll', () => { el.ipucu.hidden = true; }, { passive: true });
  }

  function oturumDegisti(oturum) {
    const oncekiId = kullanici && kullanici.id;
    kullanici = oturum ? oturum.user : null;
    el.giris.hidden = Boolean(kullanici);
    el.uygulama.hidden = !kullanici;
    if (!kullanici) {
      yeniGorunum('');
      adaylar = [];
      return;
    }
    el.kullaniciEmail.textContent = kullanici.email || '';
    if (oncekiId !== kullanici.id) yonlendir();
  }

  async function girisYap(e) {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('button[type="submit"]');
    el.girisHata.hidden = true;
    btn.disabled = true;
    try {
      const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.sifre.value });
      if (error) throw error;
      f.reset();
    } catch (err) {
      el.girisHata.textContent = /invalid login credentials/i.test(err.message || '')
        ? 'E-posta veya şifre hatalı.'
        : hataMetni(err);
      el.girisHata.hidden = false;
    } finally {
      btn.disabled = false;
    }
  }

  // ---------- yönlendirme ----------

  function yonlendir() {
    if (!kullanici) return;
    const yol = location.hash.replace(/^#/, '') || '/';
    document.querySelectorAll('.menu a').forEach(a => {
      a.classList.toggle('aktif', a.dataset.menu === (yol === '/analiz' ? 'analiz' : 'adaylar'));
    });
    let m;
    if (yol === '/analiz') return analizGoster();
    if (yol === '/') return listeGoster();
    if (yol === '/yeni') return formGoster(null);
    if ((m = yol.match(/^\/aday\/([\w-]+)\/duzenle$/))) return formGoster(m[1]);
    if ((m = yol.match(/^\/aday\/([\w-]+)$/))) return detayGoster(m[1]);
    location.hash = '#/';
  }

  // ---------- aday listesi ----------

  async function listeGoster() {
    const no = yeniGorunum('<p class="yukleniyor">Adaylar yükleniyor…</p>');
    const { data, error } = await tumunuGetir('adaylar', 'id, ad_soyad, pozisyon, departman, telefon, email, gorusme_tarihi, gorusme_turu, durum');
    if (!guncelMi(no)) return;
    if (error) return hataGorunumu(error);
    adaylar = data || [];
    const departmanlar = benzersiz(adaylar, 'departman');
    if (liste.departman && !departmanlar.includes(liste.departman)) liste.departman = '';
    const departmanSecenekleri = Object.fromEntries(departmanlar.map(d => [d, d]));

    el.icerik.innerHTML = `
      <div class="sayfa-baslik">
        <h1>Adaylar <span class="sayi" id="adaySayisi"></span></h1>
        <div class="butonlar">
          <button type="button" class="btn" id="excelBtn">Excel'e Aktar</button>
          <a href="#/yeni" class="btn birincil">+ Yeni Aday</a>
        </div>
      </div>
      <div class="arac-cubugu">
        <input type="search" id="arama" placeholder="İsim, pozisyon, telefon veya e-posta ara…" value="${esc(liste.arama)}" aria-label="Ara">
        <select id="departmanFiltre" aria-label="Departman">${secenekler(departmanSecenekleri, liste.departman, 'Tüm departmanlar')}</select>
        <select id="turFiltre" aria-label="Görüşme türü">${secenekler(GORUSME_TURLERI, liste.tur, 'Tüm görüşme türleri')}</select>
        <select id="durumFiltre" aria-label="Durum">${secenekler(DURUMLAR, liste.durum, 'Tüm durumlar')}</select>
      </div>
      <div class="tablo-kutu">
        <table class="tablo">
          <thead><tr>
            ${KOLONLAR.map(([alan, baslik]) => `<th><button type="button" class="sirala" data-alan="${alan}">${baslik}<span class="ok"></span></button></th>`).join('')}
          </tr></thead>
          <tbody id="adayGovde"></tbody>
        </table>
      </div>`;

    document.getElementById('arama').addEventListener('input', e => { liste.arama = e.target.value; tabloCiz(); });
    document.getElementById('excelBtn').addEventListener('click', e => excelAktar(e.currentTarget));
    document.getElementById('departmanFiltre').addEventListener('change', e => { liste.departman = e.target.value; tabloCiz(); });
    document.getElementById('turFiltre').addEventListener('change', e => { liste.tur = e.target.value; tabloCiz(); });
    document.getElementById('durumFiltre').addEventListener('change', e => { liste.durum = e.target.value; tabloCiz(); });
    el.icerik.querySelectorAll('.sirala').forEach(b => b.addEventListener('click', () => {
      const alan = b.dataset.alan;
      if (liste.alan === alan) liste.yon *= -1;
      else { liste.alan = alan; liste.yon = alan === 'gorusme_tarihi' ? -1 : 1; }
      tabloCiz();
    }));
    document.getElementById('adayGovde').addEventListener('click', e => {
      const tr = e.target.closest('tr[data-id]');
      if (tr && !e.target.closest('a')) location.hash = `#/aday/${tr.dataset.id}`;
    });
    tabloCiz();
  }

  function eslesir(a, q, qRakam) {
    if (!q) return true;
    if ([a.ad_soyad, a.pozisyon, a.departman, a.email, a.telefon].some(v => v && v.toLocaleLowerCase('tr').includes(q))) return true;
    return qRakam.length >= 3 && Boolean(a.telefon) && a.telefon.replace(/\D/g, '').includes(qRakam);
  }

  function karsilastir(a, b) {
    const etiket = liste.alan === 'gorusme_turu' ? GORUSME_TURLERI : liste.alan === 'durum' ? DURUMLAR : null;
    let x = a[liste.alan];
    let y = b[liste.alan];
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    if (etiket) { x = etiket[x] || x; y = etiket[y] || y; }
    return String(x).localeCompare(String(y), 'tr') * liste.yon;
  }

  function tabloCiz() {
    const q = liste.arama.trim().toLocaleLowerCase('tr');
    const qRakam = q.replace(/\D/g, '');
    const satirlar = adaylar
      .filter(a => (!liste.departman || a.departman === liste.departman) &&
                   (!liste.tur || a.gorusme_turu === liste.tur) &&
                   (!liste.durum || a.durum === liste.durum) &&
                   eslesir(a, q, qRakam))
      .sort(karsilastir);

    document.getElementById('adaySayisi').textContent =
      satirlar.length === adaylar.length ? `(${adaylar.length})` : `(${satirlar.length} / ${adaylar.length})`;

    el.icerik.querySelectorAll('.sirala').forEach(b => {
      const aktif = b.dataset.alan === liste.alan;
      b.classList.toggle('aktif', aktif);
      b.querySelector('.ok').textContent = aktif ? (liste.yon === 1 ? '▲' : '▼') : '';
    });

    const govde = document.getElementById('adayGovde');
    if (!satirlar.length) {
      govde.innerHTML = `<tr><td colspan="${KOLONLAR.length}" class="bos">${
        adaylar.length ? 'Aramaya uyan aday bulunamadı.' : 'Henüz aday eklenmemiş. “+ Yeni Aday” ile başlayabilirsin.'
      }</td></tr>`;
      return;
    }
    govde.innerHTML = satirlar.map(a => `
      <tr data-id="${esc(a.id)}">
        <td><a href="#/aday/${esc(a.id)}" class="aday-ad">${esc(a.ad_soyad)}</a></td>
        <td>${esc(a.pozisyon || '—')}</td>
        <td>${esc(a.departman || '—')}</td>
        <td>${esc(a.telefon || '—')}</td>
        <td>${tarih(a.gorusme_tarihi)}</td>
        <td>${esc(GORUSME_TURLERI[a.gorusme_turu] || '—')}</td>
        <td>${durumRozeti(a.durum)}</td>
      </tr>`).join('');
  }

  // ---------- aday detayı ----------

  async function detayGoster(id, acilacakSekme) {
    const no = yeniGorunum('<p class="yukleniyor">Aday bilgileri yükleniyor…</p>');
    const [adayS, refS] = await Promise.all([
      sb.from('adaylar').select('*').eq('id', id).maybeSingle(),
      sb.from('referans_gorusmeleri').select('*').eq('aday_id', id)
        .order('gorusme_tarihi', { ascending: false, nullsFirst: false })
        .order('olusturma_tarihi', { ascending: false })
    ]);
    if (!guncelMi(no)) return;
    if (adayS.error) return hataGorunumu(adayS.error);
    if (refS.error) return hataGorunumu(refS.error);
    const a = adayS.data;
    if (!a) return bulunamadi();
    const refs = refS.data || [];

    const altBilgi = [
      [a.pozisyon, a.departman].filter(Boolean).join(', '),
      a.gorusme_turu ? `${GORUSME_TURLERI[a.gorusme_turu]} görüşme` : '',
      a.gorusme_tarihi ? tarih(a.gorusme_tarihi) : ''
    ].filter(Boolean).join(' · ');

    el.icerik.innerHTML = `
      <a href="#/" class="geri">← Aday listesi</a>
      <div class="sayfa-baslik">
        <div>
          <h1>${esc(a.ad_soyad)}</h1>
          <div class="baslik-alt">${durumRozeti(a.durum)}<span>${esc(altBilgi)}</span></div>
        </div>
        <div class="butonlar">
          <a href="#/aday/${esc(a.id)}/duzenle" class="btn">Düzenle</a>
          <button type="button" class="btn tehlike" id="adaySilBtn">Sil</button>
        </div>
      </div>
      <div class="sekmeler" role="tablist">
        ${SEKMELER.map(([k, ad]) => `<button type="button" role="tab" data-sekme="${k}" aria-controls="panel-${k}">${ad}${
          k === 'referanslar' ? `<span class="sayac">${refs.length}</span>` : ''
        }</button>`).join('')}
      </div>
      ${SEKMELER.map(([k]) => `<div class="kart sekme-panel" role="tabpanel" id="panel-${k}" hidden></div>`).join('')}`;

    document.getElementById('panel-genel').innerHTML = genelPanel(a);
    document.getElementById('panel-notlar').innerHTML = a.gorusme_notlari
      ? `<div class="not-metni">${esc(a.gorusme_notlari)}</div>`
      : `<p class="bos">Görüşme notu girilmemiş. <a href="#/aday/${esc(a.id)}/duzenle">Not ekle</a></p>`;
    document.getElementById('panel-ucret').innerHTML = ucretPanel(a);
    referansPanel(a, refs, document.getElementById('panel-referanslar'));

    let cvYuklendi = false;
    const sekmeAc = k => {
      el.icerik.querySelectorAll('[role="tab"]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.sekme === k)));
      SEKMELER.forEach(([s]) => { document.getElementById('panel-' + s).hidden = s !== k; });
      if (k === 'cv' && !cvYuklendi) {
        cvYuklendi = true;
        cvPanel(a, document.getElementById('panel-cv'), no);
      }
    };
    el.icerik.querySelectorAll('[role="tab"]').forEach(b => b.addEventListener('click', () => sekmeAc(b.dataset.sekme)));
    document.getElementById('adaySilBtn').addEventListener('click', () => adaySil(a));
    sekmeAc(acilacakSekme || 'genel');
  }

  function genelPanel(a) {
    const satir = (etiket, deger) => `<div class="alan"><dt>${etiket}</dt><dd>${deger}</dd></div>`;
    return `<dl class="bilgi-listesi">
      ${satir('Ad Soyad', esc(a.ad_soyad))}
      ${satir('Pozisyon', esc(a.pozisyon || '—'))}
      ${satir('Departman', esc(a.departman || '—'))}
      ${satir('Telefon', a.telefon ? `<a href="tel:${esc(a.telefon.replace(/[^\d+]/g, ''))}">${esc(a.telefon)}</a>` : '—')}
      ${satir('E-posta', a.email ? `<a href="mailto:${esc(a.email)}">${esc(a.email)}</a>` : '—')}
      ${satir('Görüşme Tarihi', tarih(a.gorusme_tarihi))}
      ${satir('Görüşme Türü', esc(GORUSME_TURLERI[a.gorusme_turu] || '—'))}
      ${satir('Durum', durumRozeti(a.durum))}
      ${satir('CV', a.cv_dosya_adi ? esc(a.cv_dosya_adi) : 'Yüklenmemiş')}
      ${satir('Ekleyen', esc(a.ekleyen_email || '—'))}
      ${satir('Kayıt Tarihi', zaman(a.olusturma_tarihi))}
      ${satir('Son Güncelleme', zaman(a.guncelleme_tarihi))}
    </dl>`;
  }

  function ucretPanel(a) {
    const b = a.net_ucret_beklentisi;
    const t = a.net_ucret_teklifi;
    let fark = '—';
    if (b != null && t != null) {
      const f = t - b;
      const yuzde = b > 0 ? ` (%${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 }).format(Math.abs(f) / b * 100)})` : '';
      fark = f === 0 ? 'Teklif, beklentiyle aynı'
        : `Teklif, beklentinin ${para(Math.abs(f))} ${f > 0 ? 'üstünde' : 'altında'}${yuzde}`;
    }
    const kutu = (etiket, deger, alt) => `
      <div class="ucret-kutu">
        <div class="ucret-etiket">${etiket}</div>
        <div class="ucret-deger">${deger}</div>
        ${alt ? `<div class="ucret-alt">${alt}</div>` : ''}
      </div>`;
    const duzenle = `<a href="#/aday/${esc(a.id)}/duzenle">Düzenle</a> ekranından girebilirsin.`;
    return `
      <div class="ucret-izgara">
        ${kutu('Net ücret beklentisi', b == null ? 'Girilmemiş' : para(b), b == null ? duzenle : 'Aylık, net')}
        ${kutu('Net ücret teklifi', t == null ? 'Teklif verilmedi' : para(t), t == null ? duzenle : 'Aylık, net')}
      </div>
      ${b != null && t != null ? `<p class="ucret-fark">${esc(fark)}</p>` : ''}`;
  }

  async function cvPanel(a, kutu, no) {
    if (!a.cv_yolu) {
      kutu.innerHTML = `<p class="bos">Bu aday için CV yüklenmemiş. <a href="#/aday/${esc(a.id)}/duzenle">Düzenle</a> ekranından ekleyebilirsin.</p>`;
      return;
    }
    kutu.innerHTML = '<p class="yukleniyor">CV yükleniyor…</p>';
    const { data, error } = await sb.storage.from(CV_BUCKET).download(a.cv_yolu);
    if (!guncelMi(no)) return;
    if (error) {
      kutu.innerHTML = `<p class="hata">CV açılamadı: ${esc(hataMetni(error))}</p>`;
      return;
    }
    const pdfMi = uzanti(a.cv_yolu) === 'pdf';
    cvUrl = URL.createObjectURL(pdfMi ? new Blob([data], { type: CV_TURLERI.pdf }) : data);
    kutu.innerHTML = `
      <div class="cv-ust">
        <span class="dosya-adi">${esc(a.cv_dosya_adi || 'CV')}</span>
        <div class="butonlar">
          ${pdfMi ? `<a class="btn" href="${cvUrl}" target="_blank" rel="noopener">Yeni sekmede aç</a>` : ''}
          <a class="btn birincil" href="${cvUrl}" download="${esc(a.cv_dosya_adi || 'cv.' + uzanti(a.cv_yolu))}">İndir</a>
        </div>
      </div>
      ${pdfMi
        ? `<iframe class="cv-onizleme" src="${cvUrl}" title="CV önizleme"></iframe>`
        : '<p class="bilgi">Word dosyaları tarayıcıda önizlenemez. “İndir” ile bilgisayarında açabilirsin.</p>'}`;
  }

  async function adaySil(a) {
    if (!confirm(`"${a.ad_soyad}" adlı adayı, CV'sini ve tüm referans notlarını silmek istediğine emin misin?\nBu işlem geri alınamaz.`)) return;
    const { error } = await sb.from('adaylar').delete().eq('id', a.id);
    if (error) return bildir('Silinemedi: ' + hataMetni(error), 'hata');
    if (a.cv_yolu) await sb.storage.from(CV_BUCKET).remove([a.cv_yolu]);
    bildir('Aday silindi.', 'basari');
    location.hash = '#/';
  }

  // ---------- referans görüşmeleri ----------

  function referansPanel(a, refs, kutu) {
    kutu.innerHTML = `
      <div class="panel-ust">
        <h2>Referans Görüşmeleri</h2>
        <button type="button" class="btn birincil" id="refEkleBtn">+ Referans Ekle</button>
      </div>
      <div id="refFormKutu"></div>
      <div class="ref-liste">
        ${refs.length ? refs.map(refKart).join('') : '<p class="bos">Henüz referans görüşmesi yok.</p>'}
      </div>`;

    const formKutu = kutu.querySelector('#refFormKutu');
    kutu.querySelector('#refEkleBtn').addEventListener('click', () => refFormu(a.id, null, formKutu));
    kutu.querySelector('.ref-liste').addEventListener('click', async e => {
      const btn = e.target.closest('button[data-islem]');
      if (!btn) return;
      const r = refs.find(x => x.id === btn.closest('.ref-kart').dataset.id);
      if (!r) return;
      if (btn.dataset.islem === 'duzenle') return refFormu(a.id, r, formKutu);
      if (!confirm(`"${r.referans_kisi}" referans görüşmesini silmek istediğine emin misin?`)) return;
      const { error } = await sb.from('referans_gorusmeleri').delete().eq('id', r.id);
      if (error) return bildir('Silinemedi: ' + hataMetni(error), 'hata');
      bildir('Referans görüşmesi silindi.', 'basari');
      detayGoster(a.id, 'referanslar');
    });
  }

  function refKart(r) {
    const meta = [tarih(r.gorusme_tarihi), r.telefon ? esc(r.telefon) : '', `Ekleyen: ${esc(r.ekleyen_email || '—')}`]
      .filter(Boolean).join(' · ');
    return `
      <article class="ref-kart" data-id="${esc(r.id)}">
        <header>
          <div><strong>${esc(r.referans_kisi)}</strong>${r.sirket_pozisyon ? `<span class="soluk"> · ${esc(r.sirket_pozisyon)}</span>` : ''}</div>
          <div class="butonlar">
            <button type="button" class="btn sade" data-islem="duzenle">Düzenle</button>
            <button type="button" class="btn sade tehlike" data-islem="sil">Sil</button>
          </div>
        </header>
        <div class="ref-meta">${meta}</div>
        ${r.notlar ? `<div class="not-metni">${esc(r.notlar)}</div>` : ''}
      </article>`;
  }

  function refFormu(adayId, r, kutu) {
    kutu.innerHTML = `
      <form class="ref-form">
        <h2>${r ? 'Referans Görüşmesini Düzenle' : 'Yeni Referans Görüşmesi'}</h2>
        <div class="izgara">
          <label>Referans veren kişi *<input name="referans_kisi" required maxlength="150" value="${esc(r && r.referans_kisi)}"></label>
          <label>Şirket / Pozisyon<input name="sirket_pozisyon" maxlength="200" value="${esc(r && r.sirket_pozisyon)}"></label>
          <label>Telefon<input name="telefon" type="tel" maxlength="40" value="${esc(r && r.telefon)}"></label>
          <label>Görüşme tarihi<input name="gorusme_tarihi" type="date" value="${esc(r ? r.gorusme_tarihi : bugun())}"></label>
        </div>
        <label>Görüşme notları<textarea name="notlar" rows="5">${esc(r && r.notlar)}</textarea></label>
        <div class="butonlar">
          <button type="submit" class="btn birincil">${r ? 'Kaydet' : 'Referansı Ekle'}</button>
          <button type="button" class="btn" data-iptal>Vazgeç</button>
        </div>
      </form>`;
    const f = kutu.querySelector('form');
    f.referans_kisi.focus();
    f.querySelector('[data-iptal]').addEventListener('click', () => { kutu.innerHTML = ''; });
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const veri = {
        referans_kisi: f.referans_kisi.value.trim(),
        sirket_pozisyon: bosIseNull(f.sirket_pozisyon.value),
        telefon: bosIseNull(f.telefon.value),
        gorusme_tarihi: bosIseNull(f.gorusme_tarihi.value),
        notlar: bosIseNull(f.notlar.value)
      };
      if (!veri.referans_kisi) return bildir('Referans veren kişinin adını gir.', 'hata');
      const btn = f.querySelector('button[type="submit"]');
      btn.disabled = true;
      const { error } = r
        ? await sb.from('referans_gorusmeleri').update(veri).eq('id', r.id)
        : await sb.from('referans_gorusmeleri').insert({ ...veri, aday_id: adayId });
      if (error) {
        btn.disabled = false;
        return bildir('Kaydedilemedi: ' + hataMetni(error), 'hata');
      }
      bildir(r ? 'Referans görüşmesi güncellendi.' : 'Referans görüşmesi eklendi.', 'basari');
      detayGoster(adayId, 'referanslar');
    });
  }

  // ---------- aday ekleme / düzenleme ----------

  async function formGoster(id) {
    const no = yeniGorunum('<p class="yukleniyor">Yükleniyor…</p>');
    const [adayS, oneriS] = await Promise.all([
      id ? sb.from('adaylar').select('*').eq('id', id).maybeSingle() : Promise.resolve({ data: null, error: null }),
      tumunuGetir('adaylar', 'id, departman, pozisyon')
    ]);
    if (!guncelMi(no)) return;
    if (adayS.error) return hataGorunumu(adayS.error);
    if (id && !adayS.data) return bulunamadi();
    const a = adayS.data;
    const oneriler = oneriS.data || [];
    const oneriListesi = (listeId, alan) =>
      `<datalist id="${listeId}">${benzersiz(oneriler, alan).map(v => `<option value="${esc(v)}">`).join('')}</datalist>`;
    const d = a || {};
    const geriLink = a ? `#/aday/${esc(a.id)}` : '#/';

    el.icerik.innerHTML = `
      <a href="${geriLink}" class="geri">← ${a ? 'Aday detayına dön' : 'Aday listesi'}</a>
      <h1>${a ? 'Adayı Düzenle' : 'Yeni Aday'}</h1>
      <form id="adayFormu" class="kart form">
        <div class="izgara">
          <label>Ad Soyad *<input name="ad_soyad" required maxlength="150" value="${esc(d.ad_soyad)}"></label>
          <label>Pozisyon *<input name="pozisyon" required maxlength="150" list="pozisyonOnerileri" autocomplete="off" placeholder="ör. Muhasebe Uzmanı" value="${esc(d.pozisyon)}"></label>
          <label>Departman *<input name="departman" required maxlength="150" list="departmanOnerileri" autocomplete="off" placeholder="ör. Finans" value="${esc(d.departman)}"></label>
          <label>Telefon<input name="telefon" type="tel" maxlength="40" value="${esc(d.telefon)}"></label>
          <label>E-posta<input name="email" type="email" maxlength="200" value="${esc(d.email)}"></label>
          <label>Görüşme Tarihi *<input name="gorusme_tarihi" type="date" required value="${esc(a ? d.gorusme_tarihi : bugun())}"></label>
          <label>Görüşme Türü *<select name="gorusme_turu" required>${secenekler(GORUSME_TURLERI, d.gorusme_turu || '', 'Seçiniz')}</select></label>
          <label>Durum<select name="durum">${secenekler(DURUMLAR, d.durum || 'beklemede')}</select></label>
        </div>
        <label>Görüşme Notları<textarea name="gorusme_notlari" rows="8">${esc(d.gorusme_notlari)}</textarea></label>
        <fieldset>
          <legend>Ücret (aylık, net, ₺)</legend>
          <div class="izgara">
            <label>Net ücret beklentisi<input name="net_ucret_beklentisi" class="para" inputmode="numeric" autocomplete="off" placeholder="ör. 45.000" value="${d.net_ucret_beklentisi == null ? '' : sayiBicimi.format(d.net_ucret_beklentisi)}"></label>
            <label>Net ücret teklifi<input name="net_ucret_teklifi" class="para" inputmode="numeric" autocomplete="off" placeholder="Teklif verilmediyse boş bırak" value="${d.net_ucret_teklifi == null ? '' : sayiBicimi.format(d.net_ucret_teklifi)}"></label>
          </div>
        </fieldset>
        <fieldset>
          <legend>CV (PDF veya Word .docx, en fazla ${MAKS_CV_MB} MB)</legend>
          ${a && a.cv_yolu ? `
            <p class="ipucu">Mevcut CV: <strong>${esc(a.cv_dosya_adi)}</strong></p>
            <label class="satir"><input type="checkbox" name="cv_kaldir"> Mevcut CV'yi kaldır</label>` : ''}
          <input type="file" name="cv" accept=".pdf,.docx,${CV_TURLERI.pdf},${CV_TURLERI.docx}">
          ${a && a.cv_yolu ? '<p class="ipucu">Yeni bir dosya seçersen mevcut CV’nin yerine geçer.</p>' : ''}
        </fieldset>
        <div class="butonlar">
          <button type="submit" class="btn birincil">${a ? 'Değişiklikleri Kaydet' : 'Adayı Kaydet'}</button>
          <a href="${geriLink}" class="btn">Vazgeç</a>
        </div>
        ${oneriListesi('pozisyonOnerileri', 'pozisyon')}
        ${oneriListesi('departmanOnerileri', 'departman')}
      </form>`;

    const f = document.getElementById('adayFormu');
    if (!a) f.ad_soyad.focus();
    f.querySelectorAll('input.para').forEach(i => i.addEventListener('blur', () => paraAlaniBicimle(i)));
    f.addEventListener('submit', e => adayKaydet(e, a));
  }

  function cvKontrol(dosya) {
    if (!CV_TURLERI[uzanti(dosya.name)]) return 'CV sadece PDF veya Word (.docx) olabilir.';
    if (dosya.size > MAKS_CV_MB * 1024 * 1024) return `CV dosyası en fazla ${MAKS_CV_MB} MB olabilir.`;
    return null;
  }

  async function cvYukle(adayId, dosya) {
    const uz = uzanti(dosya.name);
    const yol = `${adayId}/${Date.now()}.${uz}`;
    const { error } = await sb.storage.from(CV_BUCKET).upload(yol, dosya, { contentType: CV_TURLERI[uz], upsert: false });
    if (error) throw error;
    return { cv_yolu: yol, cv_dosya_adi: dosya.name };
  }

  async function adayKaydet(e, a) {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('button[type="submit"]');
    const dosya = f.cv.files[0] || null;
    if (dosya) {
      const hata = cvKontrol(dosya);
      if (hata) return bildir(hata, 'hata');
    }
    const veri = {
      ad_soyad: f.ad_soyad.value.trim(),
      pozisyon: bosIseNull(f.pozisyon.value),
      departman: bosIseNull(f.departman.value),
      telefon: bosIseNull(f.telefon.value),
      email: bosIseNull(f.email.value),
      gorusme_tarihi: bosIseNull(f.gorusme_tarihi.value),
      gorusme_turu: f.gorusme_turu.value,
      durum: f.durum.value,
      gorusme_notlari: bosIseNull(f.gorusme_notlari.value),
      net_ucret_beklentisi: paraOku(f.net_ucret_beklentisi.value),
      net_ucret_teklifi: paraOku(f.net_ucret_teklifi.value)
    };
    if (!veri.ad_soyad || !veri.pozisyon || !veri.departman) return bildir('Ad soyad, pozisyon ve departman zorunlu.', 'hata');
    if ([veri.net_ucret_beklentisi, veri.net_ucret_teklifi].some(u => u != null && u > MAKS_UCRET)) {
      return bildir('Ücret değeri çok yüksek görünüyor, lütfen kontrol et.', 'hata');
    }

    const butonMetni = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Kaydediliyor…';
    let yeniCv = null;
    try {
      let id;
      let uyari = null;
      if (a) {
        id = a.id;
        let eskiCv = null;
        if (dosya) {
          yeniCv = await cvYukle(id, dosya);
          Object.assign(veri, yeniCv);
          eskiCv = a.cv_yolu;
        } else if (f.cv_kaldir && f.cv_kaldir.checked) {
          veri.cv_yolu = null;
          veri.cv_dosya_adi = null;
          eskiCv = a.cv_yolu;
        }
        const { error } = await sb.from('adaylar').update(veri).eq('id', id);
        if (error) throw error;
        yeniCv = null;
        if (eskiCv) await sb.storage.from(CV_BUCKET).remove([eskiCv]);
      } else {
        const { data, error } = await sb.from('adaylar').insert(veri).select('id').single();
        if (error) throw error;
        id = data.id;
        if (dosya) {
          try {
            const cv = await cvYukle(id, dosya);
            const { error: e2 } = await sb.from('adaylar').update(cv).eq('id', id);
            if (e2) {
              await sb.storage.from(CV_BUCKET).remove([cv.cv_yolu]);
              throw e2;
            }
          } catch (err) {
            uyari = 'Aday kaydedildi ancak CV yüklenemedi: ' + hataMetni(err);
          }
        }
      }
      bildir(uyari || 'Aday kaydedildi.', uyari ? 'hata' : 'basari');
      location.hash = `#/aday/${id}`;
    } catch (err) {
      if (yeniCv) await sb.storage.from(CV_BUCKET).remove([yeniCv.cv_yolu]);
      bildir('Kaydedilemedi: ' + hataMetni(err), 'hata');
      btn.disabled = false;
      btn.textContent = butonMetni;
    }
  }

  // ---------- Excel'e aktarma ----------

  let excelJsSozu = null;
  function excelJsYukle() {
    if (window.ExcelJS) return Promise.resolve();
    if (!excelJsSozu) {
      excelJsSozu = new Promise((tamam, hata) => {
        const s = document.createElement('script');
        s.src = EXCELJS_URL;
        s.onload = tamam;
        s.onerror = () => {
          excelJsSozu = null;
          s.remove();
          hata(new Error('Excel aracı yüklenemedi. İnternet bağlantını kontrol et.'));
        };
        document.head.appendChild(s);
      });
    }
    return excelJsSozu;
  }

  // Excel tarihleri saat dilimi bilgisi taşımaz; yerel saati olduğu gibi göstermek için kaydırıyoruz.
  function excelTarihi(d) {
    return d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`) : null;
  }
  function excelZamani(ts) {
    if (!ts) return null;
    const t = new Date(ts);
    return new Date(t.getTime() - t.getTimezoneOffset() * 60000);
  }

  function excelSayfasi(kitap, ad, kolonlar, satirlar) {
    const sayfa = kitap.addWorksheet(ad, { views: [{ state: 'frozen', ySplit: 1 }] });
    sayfa.columns = kolonlar.map(k => ({
      header: k.baslik,
      width: k.genislik,
      style: k.bicim ? { numFmt: k.bicim } : k.uzun ? { alignment: { wrapText: true, vertical: 'top' } } : {}
    }));
    satirlar.forEach(s => sayfa.addRow(kolonlar.map(k => {
      const v = k.deger(s);
      return v === undefined || v === '' ? null : v;
    })));
    const baslik = sayfa.getRow(1);
    baslik.font = { bold: true };
    baslik.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9EFFB' } };
    baslik.alignment = { vertical: 'middle' };
    sayfa.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: kolonlar.length } };
  }

  async function excelAktar(btn) {
    const metin = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Hazırlanıyor…';
    try {
      const [, adayS, refS] = await Promise.all([
        excelJsYukle(),
        tumunuGetir('adaylar', '*'),
        tumunuGetir('referans_gorusmeleri', '*')
      ]);
      if (adayS.error) throw adayS.error;
      if (refS.error) throw refS.error;
      const tumAdaylar = adayS.data.slice().sort((x, y) => String(y.gorusme_tarihi || '').localeCompare(String(x.gorusme_tarihi || '')));
      const refler = refS.data;
      const adayHaritasi = Object.fromEntries(tumAdaylar.map(a => [a.id, a]));
      const refSayisi = {};
      refler.forEach(r => { refSayisi[r.aday_id] = (refSayisi[r.aday_id] || 0) + 1; });

      const kitap = new window.ExcelJS.Workbook();
      kitap.creator = 'Aday Takip';
      kitap.created = new Date();

      excelSayfasi(kitap, 'Adaylar', [
        { baslik: 'Ad Soyad', genislik: 24, deger: a => a.ad_soyad },
        { baslik: 'Pozisyon', genislik: 24, deger: a => a.pozisyon },
        { baslik: 'Departman', genislik: 18, deger: a => a.departman },
        { baslik: 'Telefon', genislik: 16, deger: a => a.telefon },
        { baslik: 'E-posta', genislik: 28, deger: a => a.email },
        { baslik: 'Görüşme Tarihi', genislik: 15, deger: a => excelTarihi(a.gorusme_tarihi), bicim: 'dd.mm.yyyy' },
        { baslik: 'Görüşme Türü', genislik: 14, deger: a => GORUSME_TURLERI[a.gorusme_turu] },
        { baslik: 'Durum', genislik: 12, deger: a => DURUMLAR[a.durum] },
        { baslik: 'Net Ücret Beklentisi (₺)', genislik: 18, deger: a => a.net_ucret_beklentisi, bicim: '#,##0' },
        { baslik: 'Net Ücret Teklifi (₺)', genislik: 18, deger: a => a.net_ucret_teklifi, bicim: '#,##0' },
        { baslik: 'Görüşme Notları', genislik: 60, deger: a => a.gorusme_notlari, uzun: true },
        { baslik: 'CV Dosyası', genislik: 26, deger: a => a.cv_dosya_adi },
        { baslik: 'Referans Sayısı', genislik: 10, deger: a => refSayisi[a.id] || 0 },
        { baslik: 'Ekleyen', genislik: 26, deger: a => a.ekleyen_email },
        { baslik: 'Kayıt Tarihi', genislik: 18, deger: a => excelZamani(a.olusturma_tarihi), bicim: 'dd.mm.yyyy hh:mm' }
      ], tumAdaylar);

      excelSayfasi(kitap, 'Referans Görüşmeleri', [
        { baslik: 'Aday', genislik: 24, deger: r => (adayHaritasi[r.aday_id] || {}).ad_soyad },
        { baslik: 'Adayın Pozisyonu', genislik: 24, deger: r => (adayHaritasi[r.aday_id] || {}).pozisyon },
        { baslik: 'Referans Veren', genislik: 24, deger: r => r.referans_kisi },
        { baslik: 'Şirket / Pozisyon', genislik: 26, deger: r => r.sirket_pozisyon },
        { baslik: 'Telefon', genislik: 16, deger: r => r.telefon },
        { baslik: 'Görüşme Tarihi', genislik: 15, deger: r => excelTarihi(r.gorusme_tarihi), bicim: 'dd.mm.yyyy' },
        { baslik: 'Notlar', genislik: 60, deger: r => r.notlar, uzun: true },
        { baslik: 'Ekleyen', genislik: 26, deger: r => r.ekleyen_email }
      ], refler.filter(r => adayHaritasi[r.aday_id]));

      const tampon = await kitap.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([tampon], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      }));
      const baglanti = document.createElement('a');
      baglanti.href = url;
      baglanti.download = `aday-takip-${bugun()}.xlsx`;
      document.body.appendChild(baglanti);
      baglanti.click();
      baglanti.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      bildir(`${tumAdaylar.length} aday ve ${refler.length} referans görüşmesi Excel'e aktarıldı.`, 'basari');
    } catch (err) {
      bildir('Excel dosyası oluşturulamadı: ' + hataMetni(err), 'hata');
    } finally {
      btn.disabled = false;
      btn.textContent = metin;
    }
  }

  // ---------- analiz ----------

  function istatistik(sayilar) {
    if (!sayilar.length) return null;
    const s = sayilar.slice().sort((x, y) => x - y);
    const orta = Math.floor(s.length / 2);
    return {
      n: s.length,
      ort: s.reduce((t, x) => t + x, 0) / s.length,
      medyan: s.length % 2 ? s[orta] : (s[orta - 1] + s[orta]) / 2,
      min: s[0],
      max: s[s.length - 1]
    };
  }

  function yuzde(pay, payda) {
    return new Intl.NumberFormat('tr-TR', { style: 'percent', maximumFractionDigits: 0 }).format(payda ? pay / payda : 0);
  }

  async function analizGoster() {
    const no = yeniGorunum('<p class="yukleniyor">Veriler yükleniyor…</p>');
    const { data, error } = await tumunuGetir('adaylar',
      'id, departman, pozisyon, gorusme_tarihi, gorusme_turu, durum, net_ucret_beklentisi, net_ucret_teklifi');
    if (!guncelMi(no)) return;
    if (error) return hataGorunumu(error);
    const tum = data || [];
    const departmanlar = benzersiz(tum, 'departman');
    if (analiz.departman && !departmanlar.includes(analiz.departman)) analiz.departman = '';

    el.icerik.innerHTML = `
      <div class="sayfa-baslik">
        <div>
          <h1>Analiz</h1>
          <p class="sayfa-alt">Görüşmelerin, sonuçların ve ücret beklentilerinin özeti</p>
        </div>
      </div>
      <div class="filtreler">
        <label>Departman<select id="anDepartman">${secenekler(Object.fromEntries(departmanlar.map(d => [d, d])), analiz.departman, 'Tüm departmanlar')}</select></label>
        <label>Pozisyon<select id="anPozisyon"></select></label>
        <label>Görüşme tarihi (başlangıç)<input type="date" id="anBaslangic" value="${esc(analiz.baslangic)}"></label>
        <label>Görüşme tarihi (bitiş)<input type="date" id="anBitis" value="${esc(analiz.bitis)}"></label>
        <button type="button" class="btn" id="anTemizle">Filtreleri temizle</button>
      </div>
      <div id="analizSonuc"></div>`;

    const depSec = document.getElementById('anDepartman');
    const pozSec = document.getElementById('anPozisyon');
    const basGir = document.getElementById('anBaslangic');
    const bitGir = document.getElementById('anBitis');
    const sonuc = document.getElementById('analizSonuc');

    const pozisyonlariDoldur = () => {
      const kapsam = analiz.departman ? tum.filter(a => a.departman === analiz.departman) : tum;
      const pozlar = benzersiz(kapsam, 'pozisyon');
      if (analiz.pozisyon && !pozlar.includes(analiz.pozisyon)) analiz.pozisyon = '';
      pozSec.innerHTML = secenekler(Object.fromEntries(pozlar.map(p => [p, p])), analiz.pozisyon, 'Tüm pozisyonlar');
    };
    const ciz = () => {
      el.ipucu.hidden = true;
      analizCiz(sonuc, tum.filter(a =>
        (!analiz.departman || a.departman === analiz.departman) &&
        (!analiz.pozisyon || a.pozisyon === analiz.pozisyon) &&
        (!analiz.baslangic || (a.gorusme_tarihi && a.gorusme_tarihi >= analiz.baslangic)) &&
        (!analiz.bitis || (a.gorusme_tarihi && a.gorusme_tarihi <= analiz.bitis))
      ), tum.length);
    };

    depSec.addEventListener('change', () => { analiz.departman = depSec.value; pozisyonlariDoldur(); ciz(); });
    pozSec.addEventListener('change', () => { analiz.pozisyon = pozSec.value; ciz(); });
    basGir.addEventListener('change', () => { analiz.baslangic = basGir.value; ciz(); });
    bitGir.addEventListener('change', () => { analiz.bitis = bitGir.value; ciz(); });
    document.getElementById('anTemizle').addEventListener('click', () => {
      Object.assign(analiz, { departman: '', pozisyon: '', baslangic: '', bitis: '' });
      depSec.value = '';
      basGir.value = '';
      bitGir.value = '';
      pozisyonlariDoldur();
      ciz();
    });
    ipucuBagla(sonuc);
    pozisyonlariDoldur();
    ciz();
  }

  function analizCiz(kutu, kayitlar, toplam) {
    if (!kayitlar.length) {
      kutu.innerHTML = `<div class="kart"><p class="bos">${
        toplam ? 'Bu filtrelere uyan aday yok.' : 'Henüz aday eklenmemiş.'
      }</p></div>`;
      return;
    }
    const beklenti = istatistik(kayitlar.map(a => a.net_ucret_beklentisi).filter(v => v != null));
    const teklif = istatistik(kayitlar.map(a => a.net_ucret_teklifi).filter(v => v != null));
    const iseAlinan = kayitlar.filter(a => a.durum === 'ise_alindi').length;

    const kpi = (etiket, deger, alt) => `
      <div class="kpi">
        <div class="kpi-etiket">${etiket}</div>
        <div class="kpi-deger">${deger}</div>
        <div class="kpi-alt">${alt}</div>
      </div>`;

    const gruplar = new Map();
    kayitlar.forEach(a => {
      const anahtar = `${a.departman || ''}\u0000${a.pozisyon || ''}`;
      if (!gruplar.has(anahtar)) gruplar.set(anahtar, { departman: a.departman, pozisyon: a.pozisyon, kayitlar: [] });
      gruplar.get(anahtar).kayitlar.push(a);
    });
    const grupOzeti = [...gruplar.values()].map(g => ({
      ...g,
      beklenti: istatistik(g.kayitlar.map(a => a.net_ucret_beklentisi).filter(v => v != null)),
      teklif: istatistik(g.kayitlar.map(a => a.net_ucret_teklifi).filter(v => v != null)),
      iseAlinan: g.kayitlar.filter(a => a.durum === 'ise_alindi').length
    }));
    const tekDepartman = new Set(kayitlar.map(a => a.departman)).size === 1;
    const grupAdi = g => tekDepartman ? (g.pozisyon || '—') : `${g.pozisyon || '—'} · ${g.departman || '—'}`;

    const beklentiSatirlari = grupOzeti.filter(g => g.beklenti)
      .sort((x, y) => y.beklenti.ort - x.beklenti.ort)
      .map(g => ({
        etiket: grupAdi(g),
        deger: g.beklenti.ort,
        degerMetni: para(g.beklenti.ort),
        ipucu: `${grupAdi(g)}\nOrtalama: ${para(g.beklenti.ort)} · Medyan: ${para(g.beklenti.medyan)}\n` +
          `Aralık: ${para(g.beklenti.min)} – ${para(g.beklenti.max)}\n${g.beklenti.n} adayın beklentisi`
      }));

    const sayimSatirlari = (harita, alan) => Object.entries(harita).map(([k, ad]) => {
      const n = kayitlar.filter(a => a[alan] === k).length;
      return { etiket: ad, deger: n, degerMetni: sayiBicimi.format(n), ipucu: `${ad}: ${n} aday (${yuzde(n, kayitlar.length)})` };
    });

    const tabloSatirlari = grupOzeti.slice().sort((x, y) =>
      String(x.departman || '').localeCompare(String(y.departman || ''), 'tr') ||
      String(x.pozisyon || '').localeCompare(String(y.pozisyon || ''), 'tr'));

    kutu.innerHTML = `
      <div class="kpi-satiri">
        ${kpi('Görüşülen aday', sayiBicimi.format(kayitlar.length),
              `${beklenti ? beklenti.n : 0} adayın ücret beklentisi girilmiş`)}
        ${kpi('Ortalama net ücret beklentisi', beklenti ? para(beklenti.ort) : '—',
              beklenti ? `Medyan ${para(beklenti.medyan)}` : 'Ücret beklentisi girilmemiş')}
        ${kpi('Beklenti aralığı', beklenti ? `${para(beklenti.min)} – ${para(beklenti.max)}` : '—',
              beklenti ? 'En düşük – en yüksek' : 'Ücret beklentisi girilmemiş')}
        ${kpi('Ortalama net teklif', teklif ? para(teklif.ort) : '—',
              teklif ? `${teklif.n} teklif üzerinden` : 'Teklif verilmemiş')}
        ${kpi('İşe alınan', sayiBicimi.format(iseAlinan), `İşe alım oranı ${yuzde(iseAlinan, kayitlar.length)}`)}
      </div>
      ${cubukGrafik('Pozisyona göre ortalama net ücret beklentisi', 'Aylık, net. Ayrıntı için çubuğun üzerine gel.', beklentiSatirlari)}
      <div class="grafik-ikili">
        ${cubukGrafik('Duruma göre aday sayısı', '', sayimSatirlari(DURUMLAR, 'durum'))}
        ${cubukGrafik('Görüşme türüne göre aday sayısı', '', sayimSatirlari(GORUSME_TURLERI, 'gorusme_turu'))}
      </div>
      <section class="kart">
        <h2>Departman ve pozisyon bazında</h2>
        <div class="tablo-kutu gomulu">
          <table class="tablo ozet-tablo">
            <thead><tr>
              <th>Departman</th><th>Pozisyon</th><th class="sayi-hucre">Aday</th>
              <th class="sayi-hucre">Ort. beklenti</th><th class="sayi-hucre">Medyan</th>
              <th class="sayi-hucre">En düşük</th><th class="sayi-hucre">En yüksek</th>
              <th class="sayi-hucre">Ort. teklif</th><th class="sayi-hucre">İşe alınan</th>
            </tr></thead>
            <tbody>${tabloSatirlari.map(g => `
              <tr>
                <td>${esc(g.departman || '—')}</td>
                <td>${esc(g.pozisyon || '—')}</td>
                <td class="sayi-hucre">${g.kayitlar.length}</td>
                <td class="sayi-hucre">${g.beklenti ? para(g.beklenti.ort) : '—'}</td>
                <td class="sayi-hucre">${g.beklenti ? para(g.beklenti.medyan) : '—'}</td>
                <td class="sayi-hucre">${g.beklenti ? para(g.beklenti.min) : '—'}</td>
                <td class="sayi-hucre">${g.beklenti ? para(g.beklenti.max) : '—'}</td>
                <td class="sayi-hucre">${g.teklif ? para(g.teklif.ort) : '—'}</td>
                <td class="sayi-hucre">${g.iseAlinan}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </section>`;
  }

  function cubukGrafik(baslik, alt, satirlar) {
    const enBuyuk = Math.max(0, ...satirlar.map(s => s.deger));
    const govde = satirlar.length ? `
      <div class="cubuklar">
        ${satirlar.map(s => {
          const oran = enBuyuk ? s.deger / enBuyuk : 0;
          const genislik = s.deger > 0 ? `max(2px, calc((100% - 104px) * ${oran.toFixed(4)}))` : '0px';
          return `
          <div class="cubuk-satir" tabindex="0" data-ipucu="${esc(s.ipucu)}" aria-label="${esc(s.ipucu)}">
            <span class="cubuk-etiket" title="${esc(s.etiket)}">${esc(s.etiket)}</span>
            <span class="cubuk-iz">
              <span class="cubuk" style="width:${genislik}"></span>
              <span class="cubuk-deger">${esc(s.degerMetni)}</span>
            </span>
          </div>`;
        }).join('')}
      </div>` : '<p class="bos">Bu seçimde ücret beklentisi girilmiş aday yok.</p>';
    return `
      <section class="kart grafik">
        <h2>${esc(baslik)}</h2>
        ${alt ? `<p class="grafik-alt">${esc(alt)}</p>` : ''}
        ${govde}
      </section>`;
  }

  function ipucuBagla(kok) {
    const goster = (hedef, x, y) => {
      el.ipucu.textContent = hedef.dataset.ipucu;
      el.ipucu.hidden = false;
      const r = el.ipucu.getBoundingClientRect();
      el.ipucu.style.left = Math.min(Math.max(8, x + 14), window.innerWidth - r.width - 8) + 'px';
      el.ipucu.style.top = (y - r.height - 12 < 8 ? y + 18 : y - r.height - 12) + 'px';
    };
    kok.addEventListener('mousemove', e => {
      const h = e.target.closest('[data-ipucu]');
      if (h) goster(h, e.clientX, e.clientY);
      else el.ipucu.hidden = true;
    });
    kok.addEventListener('mouseleave', () => { el.ipucu.hidden = true; });
    kok.addEventListener('focusin', e => {
      const h = e.target.closest('[data-ipucu]');
      if (!h) return;
      const r = (h.querySelector('.cubuk') || h).getBoundingClientRect();
      goster(h, r.right, r.top);
    });
    kok.addEventListener('focusout', () => { el.ipucu.hidden = true; });
  }

  baslat();
})();
