import { db } from '../firebase';
import { doc, getDoc, setDoc, updateDoc, onSnapshot } from 'firebase/firestore';

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  customApiKey?: string;
  subscriptionStatus: 'free' | 'pro';
  createdAt: string;
  lastLogin: string;
}

/**
 * Đồng bộ hóa thông tin từ Auth sang Firestore khi đăng nhập
 */
export const syncUserProfile = async (authUser: any): Promise<UserProfile> => {
  const userRef = doc(db, 'users', authUser.uid);
  const docSnap = await getDoc(userRef);
  const now = new Date().toISOString();

  if (!docSnap.exists()) {
    // Nếu người dùng mới, tạo hồ sơ mặc định
    const newProfile: UserProfile = {
      uid: authUser.uid,
      email: authUser.email,
      displayName: authUser.displayName,
      photoURL: authUser.photoURL,
      subscriptionStatus: 'free',
      createdAt: now,
      lastLogin: now,
    };
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
  const userRef = doc(db, 'users', uid);
  await updateDoc(userRef, { customApiKey: apiKey });
};

/**
 * Lắng nghe thay đổi hồ sơ theo thời gian thực (Real-time)
 */
export const subscribeToUserProfile = (uid: string, callback: (profile: UserProfile) => void) => {
  const userRef = doc(db, 'users', uid);
  return onSnapshot(userRef, (doc) => {
    if (doc.exists()) {
      callback(doc.data() as UserProfile);
    }
  });
};
