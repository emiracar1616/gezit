# Gezi Hesabı

Arkadaşlarla gezi harcamalarını bölüştüren mobil uygulama. Web arayüzü + Firebase (giriş ve veritabanı) + Capacitor (Android APK).

- Herkes kendi e-posta ve şifresiyle kayıt olur / giriş yapar.
- Geziye arkadaş, onun kayıtlı e-posta adresiyle eklenir.
- Gezi sahibi herkesin harcamasını düzenleyip silebilir, diğerleri kendi harcamalarını.
- Bağlantı yokken de açılır, yapılan değişiklikler bağlantı gelince eşitlenir.

## 1. Firebase ayarı (bir kez)

1. **Authentication → Sign-in method → Email/Password** etkin olmalı.
2. **Firestore Database → Rules** sekmesine `firestore.rules` dosyasının içeriğini yapıştırıp **Publish** et.
   Bunu yapmazsan uygulama "yetkin yok" hatası verir (üretim modunda her şey kapalı başlar).

## 2. Bilgisayarda dene

Node 20 veya üstü gerekir.

```
npm install
npm test          # hesap mantığı testleri
npm run dev       # tarayıcıda dener (http://localhost:5173)
```

## 3. APK al

### Yol A: GitHub Actions (bilgisayara Android kurmadan)

1. GitHub'da boş bir depo aç, bu klasörün içeriğini (gizli `.github` klasörü dahil) yükle.
2. Depoda **Actions → Android APK → Run workflow** de.
3. İş bitince sayfanın altındaki **Artifacts** bölümünden `gezi-hesabi-apk` dosyasını indir, içinden `app-debug.apk` çıkar.
4. APK'yı telefona at, açarken "bilinmeyen kaynaklardan yüklemeye izin ver" de.

### Yol B: Android Studio

```
npm install
npm run build
npx cap add android
cp android-config/google-services.json android/app/google-services.json
npx cap sync android
npx cap open android
```

Android Studio açılınca **Build → Build APK(s)** yap. JDK 21 gerekir (Android Studio ile gelir).

Kod değiştirdikçe: `npm run android:sync`, sonra yeniden derle.

## Notlar

- Bu APK "debug" imzalıdır, kendi telefonuna ve arkadaşlarına dağıtmak için yeterli. Google Play'e yüklemek için kendi anahtarınla imzalı "release" sürümü gerekir.
- `src/firebase.js` içindeki yapılandırma gizli değildir. Veri güvenliğini `firestore.rules` sağlar.
- Şifre sıfırlama e-postası Firebase'den gelir, spam klasörüne düşebilir.
- Uygulama simgesi varsayılan Capacitor simgesidir, istenirse değiştirilir.
