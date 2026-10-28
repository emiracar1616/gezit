# Gezi Hesabı

Arkadaşlarla gezi harcamalarını bölüştüren mobil uygulama. Web arayüzü + Firebase (giriş ve veritabanı) + Capacitor (Android).

- E-posta ve şifreyle kayıt, e-posta doğrulaması zorunlu.
- Benzersiz nickname ile arkadaş ekleme. Yeni gezide ya da gezinin içinde daha önce birlikte gezilen kişiler önerilir.
- Harcama ekleme, düzenleme, silme. Harcamaya fiş fotoğrafı eklenebilir.
- Genel özet: tüm gezilerdeki alacak ve borç, para birimi bazında.
- IBAN ekleme ve ödeme önerisinden tek dokunuşla kopyalama.
- Siyah ve beyaz tema, sistem ayarını takip eden ya da elle seçilen.
- Uygulama ön plana gelince veriler yenilenir, aşağı çekerek ya da yenile düğmesiyle de yenilenebilir.

## 1. Firebase ayarı

1. **Authentication → Sign-in method → Email/Password** etkin olmalı.
2. **Firestore Database → Rules** sekmesine `firestore.rules` içeriğini yapıştırıp **Publish** et. Bu sürüm yeni kurallar içerdiği için eski kuralları da değiştirmek gerekir.

## 2. Bilgisayarda dene

Node 20 veya üstü gerekir.

```
npm install
npm test          # hesap mantığı testleri
npm run dev       # tarayıcıda dene (http://localhost:5173)
```

## 3. Debug APK (denemek için)

GitHub Actions: **Actions → Android APK → Run workflow**. Çıkan `gezi-hesabi-apk` dosyasından `app-debug.apk` telefona kurulur. Bilgisayara Android kurmak gerekmez.

## 4. Google Play'e yayın

### a) İmza anahtarı (bir kez)

Bilgisayarında (Java yüklüyse):

```
keytool -genkeypair -v -keystore gezi-release.jks -alias gezi -keyalg RSA -keysize 2048 -validity 10000
```

Oluşan `gezi-release.jks` dosyasını ve şifreleri **güvenli bir yerde sakla**. Kaybedersen uygulamayı bir daha güncelleyemezsin.

GitHub deposunda **Settings → Secrets and variables → Actions** altına şu dört gizli değeri ekle:

| Ad | Değer |
| --- | --- |
| `KEYSTORE_BASE64` | `gezi-release.jks` dosyasının base64 hali (`base64 -w0 gezi-release.jks`) |
| `KEYSTORE_PASSWORD` | keystore şifresi |
| `KEY_ALIAS` | `gezi` |
| `KEY_PASSWORD` | anahtar şifresi |

### b) Yayın dosyası (AAB)

**Actions → Google Play AAB (imzalı) → Run workflow**. Sürüm kodu her yüklemede bir artmalı (ilk için 2, sonra 3, 4...). Çıkan `gezi-hesabi-aab` dosyasındaki `app-release.aab` Play Console'a yüklenir.

### c) Play Console

1. Geliştirici hesabı aç (tek seferlik ücret), kimlik doğrulamasını tamamla.
2. Uygulamayı oluştur, paket adı: `com.emirhan.gezihesabi`.
3. **Gizlilik politikası:** GitHub Pages ile yayınla (aşağıda), bağlantıyı gir.
4. **Uygulama erişimi:** Uygulama giriş istediği için inceleyenlere test hesabı bilgisi ver (doğrulanmış bir e-posta ve şifre).
5. **Veri güvenliği** ve **içerik derecelendirmesi** formlarını doldur. Veri olarak e-posta, ad, IBAN, fotoğraf ve harcamaları işaretle.
6. **Hesap silme:** Uygulama içinde var. Play Console'a web adresini de gir (aşağıdaki `delete-account.html`).
7. Yeni kişisel hesaplarda Google, yayından önce kapalı testte en az 12 kişinin 14 gün kullanmasını isteyebilir. Play Console'da bu şartın durumunu kontrol et.
8. Mağaza görselleri: uygulama simgesi (512x512), öne çıkan görsel (1024x500) ve telefon ekran görüntüleri.

### d) Gizlilik politikası ve hesap silme sayfaları (GitHub Pages)

1. GitHub deposunda **Settings → Pages**, kaynak olarak **Deploy from a branch → main → /docs** seç.
2. Birkaç dakika sonra şu adresler açılır:
   - `https://KULLANICIADI.github.io/gezi-hesabi/privacy.html`
   - `https://KULLANICIADI.github.io/gezi-hesabi/delete-account.html`
3. `docs/privacy.html` ve `docs/delete-account.html` içindeki `[İletişim e-postası]` yazılarını kendi e-posta adresinle değiştir.

## Notlar

- Fiş ve profil fotoğrafları Firestore içinde küçültülmüş olarak saklanır. Ücretli depolama (Storage) gerekmez.
- `src/firebase.js` içindeki yapılandırma gizli değildir. Veri güvenliği `firestore.rules` ile sağlanır.
- Play'e yüklemeden önce `android/app/build.gradle` içindeki `targetSdkVersion` değerinin Play'in güncel gereksinimini karşıladığını Play Console'da kontrol et.
