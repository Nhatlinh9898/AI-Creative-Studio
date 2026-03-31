/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";
import { Loader2, Image as ImageIcon, Video, Key, Sparkles, AlertCircle, LogIn, LogOut, Settings, User as UserIcon, Save, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  User, 
  handleFirestoreError, 
  OperationType 
} from './firebase';
import { syncUserProfile, subscribeToUserProfile, updateCustomApiKeyInFirestore, UserProfile } from './services/userService';



function MainApp() {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [customApiKey, setCustomApiKey] = useState('');
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Auth & Profile Sync Listener
  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        try {
          // 1. Đồng bộ hóa hồ sơ ngay khi đăng nhập
          await syncUserProfile(currentUser);
          setUser(currentUser);

          // 2. Lắng nghe thay đổi hồ sơ (Real-time)
          unsubscribeProfile = subscribeToUserProfile(currentUser.uid, (profile) => {
            setUserProfile(profile);
            if (profile.customApiKey) {
              setCustomApiKey(profile.customApiKey);
            }
          });
        } catch (err) {
          console.error("Lỗi đồng bộ hồ sơ:", err);
          setError("Không thể đồng bộ hồ sơ người dùng.");
        }
      } else {
        setUser(null);
        setUserProfile(null);
        setCustomApiKey('');
        if (unsubscribeProfile) unsubscribeProfile();
      }
      setIsAuthReady(true);
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) unsubscribeProfile();
    };
  }, []);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error("Lỗi đăng nhập:", err);
      setError("Không thể đăng nhập bằng Google.");
    }
  };

  const handleLogout = () => signOut(auth);

  const saveApiKey = async () => {
    if (!user) return;
    setIsSavingKey(true);
    setSaveSuccess(false);
    try {
      await updateCustomApiKeyInFirestore(user.uid, customApiKey);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}`);
    } finally {
      setIsSavingKey(false);
    }
  };

  const [isUpgrading, setIsUpgrading] = useState(false);

  const handleUpgrade = async (priceId: string) => {
    if (!user) {
      handleLogin();
      return;
    }
    
    setIsUpgrading(true);
    try {
      const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid, priceId }),
      });
      
      const { url, error } = await response.json();
      if (error) throw new Error(error);
      
      // Chuyển hướng sang trang thanh toán của Stripe
      window.location.href = url;
    } catch (err: any) {
      console.error("Lỗi thanh toán:", err);
      setError("Không thể khởi tạo thanh toán. Vui lòng thử lại.");
    } finally {
      setIsUpgrading(false);
    }
  };

  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState<string | null>(null);
  const [videoStatus, setVideoStatus] = useState<string | null>(null);

  const generateVideo = async () => {
    if (!prompt.trim()) return;
    
    // Kiểm tra API Key cá nhân (Bắt buộc cho Veo)
    const aiStudio = (window as any).aistudio;
    if (aiStudio) {
      const hasKey = await aiStudio.hasSelectedApiKey();
      if (!hasKey) {
        setError("Tính năng tạo Video yêu cầu bạn phải kết nối API Key cá nhân đã bật thanh toán.");
        await aiStudio.openSelectKey();
        return;
      }
    }

    setIsGeneratingVideo(true);
    setError(null);
    setGeneratedVideoUrl(null);
    setVideoStatus("Đang khởi tạo tiến trình tạo video...");

    try {
      const userApiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
      const ai = new GoogleGenAI({ apiKey: userApiKey });
      
      let operation = await ai.models.generateVideos({
        model: 'veo-3.1-fast-generate-preview',
        prompt: prompt,
        config: {
          numberOfVideos: 1,
          resolution: '720p',
          aspectRatio: '16:9'
        }
      });

      // Polling cho đến khi hoàn tất
      while (!operation.done) {
        setVideoStatus("AI đang xử lý video của bạn (có thể mất 1-2 phút)...");
        await new Promise(resolve => setTimeout(resolve, 10000));
        operation = await ai.operations.getVideosOperation({ operation: operation });
      }

      const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
      if (downloadLink) {
        // Fetch video với API Key trong header
        const response = await fetch(downloadLink, {
          method: 'GET',
          headers: {
            'x-goog-api-key': userApiKey || '',
          },
        });
        const blob = await response.blob();
        const videoUrl = URL.createObjectURL(blob);
        setGeneratedVideoUrl(videoUrl);
      } else {
        setError("Không tìm thấy link tải video.");
      }
    } catch (err: any) {
      console.error("Lỗi tạo video:", err);
      setError(err.message || "Đã xảy ra lỗi khi tạo video.");
    } finally {
      setIsGeneratingVideo(false);
      setVideoStatus(null);
    }
  };

  const generateImage = async () => {
    if (!prompt.trim()) return;
    
    setIsGenerating(true);
    setError(null);
    setGeneratedImageUrl(null);

    try {
      // Ưu tiên dùng khóa cá nhân lưu trong Firestore, sau đó là khóa hệ thống
      const effectiveApiKey = customApiKey || process.env.GEMINI_API_KEY;
      
      if (!effectiveApiKey) {
        throw new Error("Vui lòng đăng nhập và thiết lập API Key của bạn.");
      }

      const ai = new GoogleGenAI({ apiKey: effectiveApiKey });
      
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [{ text: prompt }],
        },
      });

      let foundImage = false;
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          const imageUrl = `data:image/png;base64,${part.inlineData.data}`;
          setGeneratedImageUrl(imageUrl);
          foundImage = true;
          break;
        }
      }

      if (!foundImage) {
        setError("Không tìm thấy dữ liệu hình ảnh trong phản hồi.");
      }
    } catch (err: any) {
      console.error("Lỗi tạo ảnh:", err);
      setError(err.message || "Đã xảy ra lỗi khi tạo ảnh.");
    } finally {
      setIsGenerating(false);
    }
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-orange-500/30">
      {/* Header */}
      <header className="border-b border-white/10 p-6 flex justify-between items-center backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-red-600 rounded-xl flex items-center justify-center shadow-lg shadow-orange-500/20">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-white/60">
            AI Creative Studio
          </h1>
        </div>
        
        <div className="flex items-center gap-4">
          {user ? (
            <div className="flex items-center gap-3">
              <button 
                onClick={() => setShowSettings(!showSettings)}
                className="p-2 rounded-full hover:bg-white/5 transition-colors"
                title="Cài đặt API Key"
              >
                <Settings className={`w-5 h-5 ${customApiKey ? 'text-green-400' : 'text-white/60'}`} />
              </button>
              <div className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-full border border-white/10">
                <img src={user.photoURL || ''} alt="" className="w-6 h-6 rounded-full" />
                <span className="text-sm font-medium hidden sm:inline">{user.displayName}</span>
                {userProfile?.subscriptionStatus === 'pro' && (
                  <span className="px-2 py-0.5 bg-orange-500 text-[10px] font-bold rounded-full uppercase tracking-wider">
                    Pro
                  </span>
                )}
                <button onClick={handleLogout} className="ml-2 text-white/40 hover:text-white transition-colors">
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            <button 
              onClick={handleLogin}
              className="flex items-center gap-2 px-4 py-2 bg-white text-black rounded-full text-sm font-bold hover:bg-white/90 transition-all"
            >
              <LogIn className="w-4 h-4" />
              Đăng nhập
            </button>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-8">
        {/* Settings Modal */}
        <AnimatePresence>
          {showSettings && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="mb-8 p-6 rounded-3xl bg-white/5 border border-white/10 relative overflow-hidden"
            >
              <div className="flex items-center gap-3 mb-4">
                <Key className="w-5 h-5 text-orange-500" />
                <h3 className="text-lg font-bold">Cài đặt API Key cá nhân</h3>
              </div>
              <p className="text-white/60 text-sm mb-4">
                Khóa này sẽ được lưu trữ độc lập cho tài khoản của bạn. 
                Nó cho phép bạn sử dụng các tính năng cao cấp mà không phụ thuộc vào hạn ngạch chung của ứng dụng.
              </p>
              <div className="flex gap-2">
                <input 
                  type="password"
                  value={customApiKey}
                  onChange={(e) => setCustomApiKey(e.target.value)}
                  placeholder="Nhập Gemini API Key của bạn..."
                  className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                />
                <button 
                  onClick={saveApiKey}
                  disabled={isSavingKey}
                  className="px-4 py-2 bg-orange-500 text-white rounded-xl text-sm font-bold hover:bg-orange-600 disabled:opacity-50 flex items-center gap-2"
                >
                  {isSavingKey ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Lưu
                </button>
              </div>
              {saveSuccess && (
                <motion.div 
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-2 text-green-400 text-xs flex items-center gap-1"
                >
                  <CheckCircle2 className="w-3 h-3" />
                  Đã lưu thành công!
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {!user && (
          <div className="mb-12 p-8 rounded-3xl bg-gradient-to-br from-orange-500/10 to-red-500/5 border border-orange-500/20 text-center">
            <UserIcon className="w-12 h-12 text-orange-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-2">Chào mừng bạn!</h2>
            <p className="text-white/60 mb-6 max-w-md mx-auto">
              Đăng nhập để lưu trữ API Key cá nhân và quản lý các tác phẩm nghệ thuật của riêng bạn.
            </p>
            <button 
              onClick={handleLogin}
              className="px-8 py-3 bg-white text-black rounded-2xl font-bold hover:bg-white/90 transition-all shadow-xl shadow-white/10"
            >
              Bắt đầu ngay
            </button>
          </div>
        )}

        {/* Pricing Table */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
          <div className="p-8 rounded-3xl bg-white/5 border border-white/10 flex flex-col">
            <h3 className="text-xl font-bold mb-2">Gói Miễn Phí</h3>
            <p className="text-white/40 text-sm mb-6">Dành cho người mới bắt đầu khám phá.</p>
            <div className="text-3xl font-bold mb-8">$0<span className="text-sm text-white/40 font-normal">/tháng</span></div>
            <ul className="space-y-3 mb-8 flex-1">
              <li className="text-sm text-white/60 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-400" />
                Tạo 10 ảnh mỗi ngày
              </li>
              <li className="text-sm text-white/60 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-400" />
                Độ phân giải tiêu chuẩn
              </li>
            </ul>
            <button className="w-full py-3 rounded-xl bg-white/10 text-white/40 font-bold cursor-not-allowed">
              {userProfile?.subscriptionStatus === 'free' ? 'Đang sử dụng' : 'Gói cơ bản'}
            </button>
          </div>

          <div className="p-8 rounded-3xl bg-gradient-to-br from-orange-500/20 to-red-500/10 border border-orange-500/30 flex flex-col relative overflow-hidden">
            <div className="absolute top-4 right-4 px-3 py-1 bg-orange-500 text-white text-[10px] font-bold rounded-full uppercase tracking-wider">
              Phổ biến nhất
            </div>
            <h3 className="text-xl font-bold mb-2">Gói Pro</h3>
            <p className="text-white/40 text-sm mb-6">Sáng tạo không giới hạn với tốc độ cao.</p>
            <div className="text-3xl font-bold mb-8">$19<span className="text-sm text-white/40 font-normal">/tháng</span></div>
            <ul className="space-y-3 mb-8 flex-1">
              <li className="text-sm text-white/60 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-orange-500" />
                Tạo ảnh không giới hạn
              </li>
              <li className="text-sm text-white/60 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-orange-500" />
                Ưu tiên xử lý nhanh
              </li>
              <li className="text-sm text-white/60 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-orange-500" />
                Tải ảnh chất lượng 4K
              </li>
            </ul>
            <button 
              onClick={() => handleUpgrade('price_12345')} // Thay bằng Price ID thực tế từ Stripe
              disabled={isUpgrading || userProfile?.subscriptionStatus === 'pro'}
              className={`w-full py-3 rounded-xl font-bold transition-all shadow-lg flex items-center justify-center gap-2 ${
                userProfile?.subscriptionStatus === 'pro' 
                  ? 'bg-green-500/20 text-green-400 border border-green-500/30 cursor-default' 
                  : 'bg-orange-500 text-white hover:bg-orange-600 shadow-orange-500/20'
              }`}
            >
              {isUpgrading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : userProfile?.subscriptionStatus === 'pro' ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              {userProfile?.subscriptionStatus === 'pro' ? 'Đã là Pro' : 'Nâng cấp ngay'}
            </button>
          </div>
        </div>

        {/* Input Area */}
        <div className="space-y-6">
          <div className="relative group">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Mô tả hình ảnh bạn muốn tạo..."
              className="w-full h-32 bg-white/5 border border-white/10 rounded-2xl p-6 text-lg focus:outline-none focus:ring-2 focus:ring-orange-500/50 transition-all resize-none placeholder:text-white/20"
            />
            <div className="absolute bottom-4 right-4 flex gap-2">
              <button 
                disabled={isGenerating || isGeneratingVideo || !prompt}
                onClick={generateImage}
                className="flex items-center gap-2 px-6 py-3 bg-white text-black rounded-xl font-bold hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <ImageIcon className="w-5 h-5" />}
                Tạo Ảnh
              </button>
              <button 
                disabled={isGenerating || isGeneratingVideo || !prompt}
                onClick={generateVideo}
                className="flex items-center gap-2 px-6 py-3 bg-white/10 text-white rounded-xl font-bold hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all border border-white/5"
              >
                {isGeneratingVideo ? <Loader2 className="w-5 h-5 animate-spin" /> : <Video className="w-5 h-5" />}
                Tạo Video
              </button>
            </div>
          </div>

          {/* Results Area */}
          <AnimatePresence mode="wait">
            {videoStatus && (
              <motion.div 
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }}
                className="p-4 rounded-xl bg-orange-500/10 border border-orange-500/20 text-orange-400 text-sm flex items-center gap-2"
              >
                <Loader2 className="w-4 h-4 animate-spin" />
                {videoStatus}
              </motion.div>
            )}

            {error && (
              <motion.div 
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }} 
                exit={{ opacity: 0 }}
                className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2"
              >
                <AlertCircle className="w-4 h-4" />
                {error}
              </motion.div>
            )}

            {isGenerating && (
              <motion.div 
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }}
                className="aspect-square w-full max-w-md mx-auto rounded-3xl bg-white/5 border border-dashed border-white/20 flex flex-col items-center justify-center gap-4"
              >
                <div className="relative">
                  <div className="w-16 h-16 border-4 border-orange-500/20 border-t-orange-500 rounded-full animate-spin" />
                  <Sparkles className="w-6 h-6 text-orange-500 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                </div>
                <p className="text-white/40 font-medium animate-pulse">Đang sáng tạo tác phẩm...</p>
              </motion.div>
            )}

            {generatedImageUrl && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }} 
                animate={{ opacity: 1, scale: 1 }}
                className="relative group rounded-3xl overflow-hidden shadow-2xl shadow-orange-500/10"
              >
                <img 
                  src={generatedImageUrl} 
                  alt="AI Generated" 
                  className="w-full h-auto object-cover"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-8">
                  <button 
                    onClick={() => {
                      const link = document.createElement('a');
                      link.href = generatedImageUrl;
                      link.download = 'ai-art.png';
                      link.click();
                    }}
                    className="px-4 py-2 bg-white text-black rounded-lg text-sm font-bold hover:bg-white/90"
                  >
                    Tải Xuống
                  </button>
                </div>
              </motion.div>
            )}

            {generatedVideoUrl && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }} 
                animate={{ opacity: 1, scale: 1 }}
                className="relative group rounded-3xl overflow-hidden shadow-2xl shadow-orange-500/10"
              >
                <video 
                  src={generatedVideoUrl} 
                  controls 
                  autoPlay 
                  className="w-full h-auto object-cover"
                />
                <div className="absolute top-4 right-4">
                  <button 
                    onClick={() => {
                      const link = document.createElement('a');
                      link.href = generatedVideoUrl;
                      link.download = 'ai-video.mp4';
                      link.click();
                    }}
                    className="px-4 py-2 bg-white/20 backdrop-blur-md text-white rounded-lg text-sm font-bold hover:bg-white/30"
                  >
                    Tải Video
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <MainApp />
  );
}
