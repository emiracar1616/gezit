"""Capacitor'ın ürettiği android/app/build.gradle dosyasına imzalama ayarlarını ve sürüm numarasını ekler.
Kullanım: python3 scripts/patch-android.py <build.gradle yolu> <versionCode> <versionName>
İmza bilgileri ortam değişkenlerinden okunur: KEYSTORE_PATH, KEYSTORE_PASSWORD, KEY_ALIAS, KEY_PASSWORD"""
import os
import re
import sys

path, code, name = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(path, encoding='utf-8').read()

def must(pattern):
    if not re.search(pattern, src):
        sys.exit('Beklenen yapı bulunamadı: ' + pattern)

must(r'android\s*\{')
must(r'buildTypes\s*\{')
must(r'release\s*\{')

signing = """
    signingConfigs {
        release {
            storeFile file(System.getenv("KEYSTORE_PATH") ?: "release.jks")
            storePassword System.getenv("KEYSTORE_PASSWORD") ?: ""
            keyAlias System.getenv("KEY_ALIAS") ?: ""
            keyPassword System.getenv("KEY_PASSWORD") ?: ""
        }
    }
"""

# signingConfigs bloğunu buildTypes'tan önce ekle
src = re.sub(r'(\n\s*)buildTypes\s*\{', lambda m: signing + m.group(1) + 'buildTypes {', src, count=1)
# release bloğuna imzayı bağla
src = re.sub(r'(buildTypes\s*\{[^}]*?release\s*\{)', lambda m: m.group(1) + '\n            signingConfig signingConfigs.release', src, count=1, flags=re.S)
# sürüm bilgisi
src = re.sub(r'versionCode\s+\d+', 'versionCode ' + code, src, count=1)
src = re.sub(r'versionName\s+"[^"]*"', 'versionName "' + name + '"', src, count=1)

open(path, 'w', encoding='utf-8').write(src)
print('build.gradle güncellendi: versionCode', code, 'versionName', name)
