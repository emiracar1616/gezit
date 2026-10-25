import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, initializeFirestore, persistentLocalCache } from 'firebase/firestore';

// Firebase web yapılandırması gizli bir bilgi değildir; güvenlik firestore.rules ile sağlanır.
const firebaseConfig = {
  apiKey: 'AIzaSyC5sMhV7yRBLe-P_axqK4nU_X0mG5sKN30',
  authDomain: 'gezit-54adf.firebaseapp.com',
  projectId: 'gezit-54adf',
  storageBucket: 'gezit-54adf.firebasestorage.app',
  messagingSenderId: '852875072207',
  appId: '1:852875072207:web:8b101373910101b3129dba'
};

export const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
auth.languageCode = 'tr';

let firestore;
try {
  // Çevrimdışı önbellek + Android WebView'da bağlantı sorunlarına karşı otomatik uzun-yoklama
  firestore = initializeFirestore(app, {
    localCache: persistentLocalCache({}),
    experimentalAutoDetectLongPolling: true
  });
} catch (e) {
  firestore = getFirestore(app);
}
export const db = firestore;
