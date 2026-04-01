import { db } from '../firebase';
import { doc, getDoc, setDoc, updateDoc, onSnapshot, collection, query, where, getDocs } from 'firebase/firestore';

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  customApiKey?: string;
  subscriptionStatus: 'free' | 'pro' | 'business';
  credits: number;
  totalSpent: number;
  referralCode: string;
  referredBy?: string;
  commissionBalance: number;
  createdAt: string;
  lastLogin: string;
}

/**
 * Tạo mã giới thiệu ngẫu nhiên
 */
const generateReferralCode = () => {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
};

/**
 * Đồng bộ hóa thông tin từ Auth sang Firestore khi đăng nhập
 */
export const syncUserProfile = async (authUser: any): Promise<UserProfile | null> => {
  if (!db) return null;
  const userRef = doc(db, 'users', authUser.uid);
  const docSnap = await getDoc(userRef);
  const now = new Date().toISOString();

  // Kiểm tra mã giới thiệu từ URL
  const urlParams = new URLSearchParams(window.location.search);
  const referralCode = urlParams.get('ref');

  if (!docSnap.exists()) {
    let referredBy: string | undefined = undefined;
    
    // Tìm người giới thiệu nếu có mã
    if (referralCode) {
      try {
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('referralCode', '==', referralCode));
        const querySnap = await getDocs(q);
        if (!querySnap.empty) {
          referredBy = querySnap.docs[0].id;
        }
      } catch (e) {
        console.error("Lỗi tìm người giới thiệu:", e);
      }
    }

    // Nếu người dùng mới, tạo hồ sơ mặc định
    const newProfile: UserProfile = {
      uid: authUser.uid,
      email: authUser.email,
      displayName: authUser.displayName,
      photoURL: authUser.photoURL,
      subscriptionStatus: 'free',
      credits: 5, // Tặng 5 credit cho người dùng mới
      totalSpent: 0,
      referralCode: generateReferralCode(),
      commissionBalance: 0,
      createdAt: now,
      lastLogin: now,
    };

    // Chỉ thêm referredBy nếu có giá trị
    if (referredBy) {
      newProfile.referredBy = referredBy;
    }

    await setDoc(userRef, newProfile);
    return newProfile;
  } else {
    // Nếu người dùng cũ, cập nhật thời gian đăng nhập cuối
    const existingData = docSnap.data() as UserProfile;
    await updateDoc(userRef, { lastLogin: now });
    return { ...existingData, lastLogin: now };
  }
};

/**
 * Cập nhật API Key cá nhân vào Firestore
 */
export const updateCustomApiKeyInFirestore = async (uid: string, apiKey: string) => {
  if (!db) return;
  const userRef = doc(db, 'users', uid);
  await updateDoc(userRef, { customApiKey: apiKey });
};

/**
 * Khấu trừ credit khi sử dụng dịch vụ
 */
export const deductCredits = async (uid: string, amount: number): Promise<boolean> => {
  if (!db) return false;
  const userRef = doc(db, 'users', uid);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) return false;

  const userData = userSnap.data() as UserProfile;
  if (userData.subscriptionStatus === 'business') return true; // Business không tốn credit
  
  if ((userData.credits || 0) < amount) return false;

  await updateDoc(userRef, {
    credits: userData.credits - amount
  });
  return true;
};
export const subscribeToUserProfile = (uid: string, callback: (profile: UserProfile) => void) => {
  if (!db) return () => {};
  const userRef = doc(db, 'users', uid);
  return onSnapshot(userRef, (doc) => {
    if (doc.exists()) {
      callback(doc.data() as UserProfile);
    }
  });
};
