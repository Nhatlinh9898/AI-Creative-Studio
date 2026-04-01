/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { 
  Loader2, 
  Image as ImageIcon, 
  Video, 
  Key, 
  Sparkles, 
  AlertCircle, 
  LogIn, 
  LogOut, 
  Settings, 
  User as UserIcon, 
  Save, 
  CheckCircle2, 
  Coins, 
  Share2, 
  Wallet, 
  TrendingUp, 
  Copy,
  MessageSquare,
  Music,
  Mic,
  Code2,
  BarChart3,
  Box,
  Layers,
  ChevronRight,
  Download,
  Play,
  Pause
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
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
import { syncUserProfile, subscribeToUserProfile, updateCustomApiKeyInFirestore, UserProfile, deductCredits } from './services/userService';
import { AIService } from './services/aiService';

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
  const [isUpgrading, setIsUpgrading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'creative' | 'intelligence' | 'multimedia' | 'developer'>('creative');

  // Intelligence State
  const [chatInput, setChatInput] = useState('');
  const [chatResponse, setChatResponse] = useState('');
  const [isChatting, setIsChatting] = useState(false);

  // Multimedia State
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [audioMode, setAudioMode] = useState<'music' | 'speech'>('music');

  // Developer State
  const [codeResponse, setCodeResponse] = useState('');
  const [isGeneratingCode, setIsGeneratingCode] = useState(false);
  const [analysisFile, setAnalysisFile] = useState<File | null>(null);
  const [previewCode, setPreviewCode] = useState<string | null>(null);
  const [codeType, setCodeType] = useState<'threejs' | 'blender'>('threejs');

  // Initialize AI Service
  const getAIService = () => {
    const apiKey = customApiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("Vui lòng thiết lập API Key trong phần Cài đặt.");
    return new AIService({ apiKey, userId: user?.uid });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Auth & Profile Sync Listener
  useEffect(() => {
    if (!auth) {
      setIsAuthReady(true);
      return;
    }
    let unsubscribeProfile: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        setIsAuthReady(true); // Set ready as soon as we have the user
        
        try {
          // 1. Đồng bộ hóa hồ sơ ngay khi đăng nhập
          await syncUserProfile(currentUser);

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
        setIsAuthReady(true);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) unsubscribeProfile();
    };
  }, []);

  // Safety timeout for loading state
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!isAuthReady) {
        console.warn("Auth initialization timed out, forcing ready state.");
        setIsAuthReady(true);
      }
    }, 5000);
    return () => clearTimeout(timer);
  }, [isAuthReady]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAnalysisFile(file);
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setChatInput(prev => `${prev}\n\n[Dữ liệu từ file ${file.name}]:\n${content}`);
    };
    reader.readAsText(file);
  };

  const createWavHeader = (pcmData: Uint8Array, sampleRate: number = 24000) => {
    const buffer = new ArrayBuffer(44 + pcmData.length);
    const view = new DataView(buffer);
    view.setUint32(0, 0x52494646, false); // "RIFF"
    view.setUint32(4, 36 + pcmData.length, true);
    view.setUint32(8, 0x57415645, false); // "WAVE"
    view.setUint32(12, 0x666d7420, false); // "fmt "
    view.setUint32(16, 16, true); // fmt chunk size
    view.setUint16(20, 1, true); // audio format (PCM)
    view.setUint16(22, 1, true); // num channels
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    view.setUint32(36, 0x64617461, false); // "data"
    view.setUint32(40, pcmData.length, true);
    const uint8View = new Uint8Array(buffer, 44);
    uint8View.set(pcmData);
    return new Blob([buffer], { type: 'audio/wav' });
  };

  const handleLogin = async () => {
    if (!auth || !googleProvider) {
      setError("Hệ thống xác thực chưa sẵn sàng.");
      return;
    }
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error("Lỗi đăng nhập:", err);
      setError("Không thể đăng nhập bằng Google.");
    }
  };

  const handleLogout = () => auth && signOut(auth);

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

  const handleUpgrade = async (plan: 'pro' | 'business', priceId: string) => {
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
      console.error("Lỗi nâng cấp:", err);
      setError("Không thể thực hiện nâng cấp. Vui lòng thử lại.");
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
    setVideoStatus("Đang kiểm tra số dư và khởi tạo...");

    try {
      const ai = getAIService();
      const videoUrl = await ai.generateVideo(prompt, (status) => setVideoStatus(status));
      setGeneratedVideoUrl(videoUrl);
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
      const ai = getAIService();
      const imageUrl = await ai.generateImage(prompt);
      setGeneratedImageUrl(imageUrl);
    } catch (err: any) {
      console.error("Lỗi tạo ảnh:", err);
      setError(err.message || "Đã xảy ra lỗi khi tạo ảnh.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleChat = async () => {
    if (!chatInput.trim()) return;
    setIsChatting(true);
    setError(null);
    setChatResponse('');
    try {
      const ai = getAIService();
      const response = await ai.chat(chatInput);
      setChatResponse(response);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsChatting(false);
    }
  };

  const generateAudio = async () => {
    if (!prompt.trim()) return;
    setIsGeneratingAudio(true);
    setError(null);
    setAudioUrl(null);
    try {
      const ai = getAIService();
      const result = await ai.generateAudio(prompt, audioMode);
      
      if (audioMode === 'music') {
        setAudioUrl(URL.createObjectURL(result as Blob));
      } else {
        const wavBlob = createWavHeader(result as Uint8Array);
        setAudioUrl(URL.createObjectURL(wavBlob));
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsGeneratingAudio(false);
    }
  };

  const generateCode = async (type: 'threejs' | 'blender') => {
    if (!prompt.trim()) return;
    setIsGeneratingCode(true);
    setError(null);
    setCodeType(type);
    setPreviewCode(null);
    try {
      const ai = getAIService();
      const response = await ai.generateCode(prompt, type);
      setCodeResponse(response);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsGeneratingCode(false);
    }
  };

  const runPreview = () => {
    if (!codeResponse || codeType !== 'threejs') return;
    
    const fullCode = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Three.js Preview</title>
          <style>
            body { margin: 0; background: #000; overflow: hidden; }
            canvas { width: 100%; height: 100%; }
          </style>
          <script type="importmap">
            {
              "imports": {
                "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
                "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/"
              }
            }
          </script>
        </head>
        <body>
          <script type="module">
            import * as THREE from 'three';
            const scene = new THREE.Scene();
            const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
            const renderer = new THREE.WebGLRenderer({ antialias: true });
            renderer.setSize(window.innerWidth, window.innerHeight);
            document.body.appendChild(renderer.domElement);
            const container = document.body;
            
            try {
              ${codeResponse}
            } catch (e) {
              console.error("Three.js Runtime Error:", e);
              document.body.innerHTML = '<div style="color: red; padding: 20px;">Lỗi thực thi: ' + e.message + '</div>';
            }
            
            window.addEventListener('resize', () => {
              camera.aspect = window.innerWidth / window.innerHeight;
              camera.updateProjectionMatrix();
              renderer.setSize(window.innerWidth, window.innerHeight);
            });
          </script>
        </body>
      </html>
    `;
    setPreviewCode(fullCode);
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
          {user && (
            <div className="hidden md:flex items-center gap-4 mr-2">
              <div className="flex items-center gap-2 bg-orange-500/10 border border-orange-500/20 px-3 py-1.5 rounded-full">
                <Coins className="w-4 h-4 text-orange-500" />
                <span className="text-sm font-bold text-orange-500">
                  {userProfile?.subscriptionStatus === 'business' ? '∞' : userProfile?.credits || 0}
                </span>
              </div>
              {userProfile?.commissionBalance && userProfile.commissionBalance > 0 ? (
                <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/20 px-3 py-1.5 rounded-full">
                  <Wallet className="w-4 h-4 text-green-400" />
                  <span className="text-sm font-bold text-green-400">
                    {userProfile.commissionBalance.toLocaleString()}đ
                  </span>
                </div>
              ) : null}
            </div>
          )}
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
                {userProfile?.subscriptionStatus && userProfile.subscriptionStatus !== 'free' && (
                  <span className="px-2 py-0.5 bg-orange-500 text-[10px] font-bold rounded-full uppercase tracking-wider">
                    {userProfile.subscriptionStatus}
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

      <main className="max-w-6xl mx-auto p-8">
        {/* Navigation Tabs */}
        <div className="flex flex-wrap gap-2 mb-8 bg-white/5 p-1.5 rounded-2xl border border-white/10 w-fit mx-auto">
          {[
            { id: 'creative', icon: Sparkles, label: 'Creative Studio' },
            { id: 'intelligence', icon: MessageSquare, label: 'Intelligence Hub' },
            { id: 'multimedia', icon: Music, label: 'Multimedia Lab' },
            { id: 'developer', icon: Code2, label: 'Developer Forge' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                activeTab === tab.id 
                  ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20' 
                  : 'text-white/40 hover:text-white/60'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Settings Modal */}
        <AnimatePresence>
          {showSettings && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="mb-8 space-y-6"
            >
              {/* API Key Section */}
              <div className="p-6 rounded-3xl bg-white/5 border border-white/10 relative overflow-hidden">
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
              </div>

              {/* Referral & Commission Section */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="p-6 rounded-3xl bg-white/5 border border-white/10">
                  <div className="flex items-center gap-3 mb-4">
                    <Share2 className="w-5 h-5 text-blue-400" />
                    <h3 className="text-lg font-bold">Chương trình đối tác</h3>
                  </div>
                  <p className="text-white/60 text-sm mb-4">
                    Chia sẻ mã giới thiệu của bạn và nhận ngay 20% hoa hồng khi bạn bè nâng cấp gói cước.
                  </p>
                  <div className="flex items-center justify-between bg-black/40 border border-white/10 rounded-xl px-4 py-3">
                    <span className="font-mono text-orange-500 font-bold tracking-widest">{userProfile?.referralCode}</span>
                    <button 
                      onClick={() => copyToClipboard(`${window.location.origin}/?ref=${userProfile?.referralCode}`)}
                      className="text-white/40 hover:text-white transition-colors flex items-center gap-2"
                    >
                      <span className="text-[10px] uppercase font-bold">Copy Link</span>
                      {copied ? <CheckCircle2 className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="p-6 rounded-3xl bg-white/5 border border-white/10">
                  <div className="flex items-center gap-3 mb-4">
                    <TrendingUp className="w-5 h-5 text-green-400" />
                    <h3 className="text-lg font-bold">Thu nhập của bạn</h3>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-sm text-white/40">Số dư hoa hồng</span>
                    <span className="text-3xl font-bold text-green-400">
                      {userProfile?.commissionBalance?.toLocaleString() || 0}đ
                    </span>
                  </div>
                  <button className="mt-4 w-full py-2 bg-white/5 border border-white/10 rounded-xl text-xs font-bold hover:bg-white/10 transition-colors">
                    Yêu cầu rút tiền
                  </button>
                </div>
              </div>

              {saveSuccess && (
                <motion.div 
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-green-400 text-xs flex items-center justify-center gap-1"
                >
                  <CheckCircle2 className="w-3 h-3" />
                  Đã cập nhật thành công!
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          <div className="p-8 rounded-3xl bg-white/5 border border-white/10 flex flex-col">
            <h3 className="text-xl font-bold mb-2">Gói Miễn Phí</h3>
            <p className="text-white/40 text-sm mb-6">Dành cho người mới bắt đầu khám phá.</p>
            <div className="text-3xl font-bold mb-8">0đ<span className="text-sm text-white/40 font-normal">/tháng</span></div>
            <ul className="space-y-3 mb-8 flex-1">
              <li className="text-sm text-white/60 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-400" />
                Tặng 5 credit trải nghiệm
              </li>
              <li className="text-sm text-white/60 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-400" />
                Tạo tối đa 5 ảnh
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
            <div className="text-3xl font-bold mb-8">199k<span className="text-sm text-white/40 font-normal">/tháng</span></div>
            <ul className="space-y-3 mb-8 flex-1">
              <li className="text-sm text-white/60 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-orange-500" />
                500 Credits mỗi tháng
              </li>
              <li className="text-sm text-white/60 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-orange-500" />
                Ưu tiên xử lý nhanh
              </li>
              <li className="text-sm text-white/60 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-orange-500" />
                Tạo được Video ngắn
              </li>
            </ul>
            <button 
              onClick={() => handleUpgrade('pro', 'price_pro_123')} 
              disabled={isUpgrading || userProfile?.subscriptionStatus === 'pro' || userProfile?.subscriptionStatus === 'business'}
              className={`w-full py-3 rounded-xl font-bold transition-all shadow-lg flex items-center justify-center gap-2 ${
                userProfile?.subscriptionStatus === 'pro' || userProfile?.subscriptionStatus === 'business'
                  ? 'bg-green-500/20 text-green-400 border border-green-500/30 cursor-default' 
                  : 'bg-orange-500 text-white hover:bg-orange-600 shadow-orange-500/20'
              }`}
            >
              {isUpgrading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (userProfile?.subscriptionStatus === 'pro' || userProfile?.subscriptionStatus === 'business') ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              {(userProfile?.subscriptionStatus === 'pro' || userProfile?.subscriptionStatus === 'business') ? 'Đã kích hoạt' : 'Nâng cấp ngay'}
            </button>
          </div>

          <div className="p-8 rounded-3xl bg-gradient-to-br from-purple-500/20 to-blue-500/10 border border-purple-500/30 flex flex-col relative overflow-hidden">
            <h3 className="text-xl font-bold mb-2">Gói Business</h3>
            <p className="text-white/40 text-sm mb-6">Giải pháp tối ưu cho doanh nghiệp.</p>
            <div className="text-3xl font-bold mb-8">499k<span className="text-sm text-white/40 font-normal">/tháng</span></div>
            <ul className="space-y-3 mb-8 flex-1">
              <li className="text-sm text-white/60 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-purple-500" />
                Không giới hạn Credits
              </li>
              <li className="text-sm text-white/60 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-purple-500" />
                Tạo Video Veo không giới hạn
              </li>
              <li className="text-sm text-white/60 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-purple-500" />
                Hỗ trợ ưu tiên 24/7
              </li>
            </ul>
            <div className="space-y-3">
              <button 
                onClick={() => handleUpgrade('business', 'price_business_456')} 
                disabled={isUpgrading || userProfile?.subscriptionStatus === 'business'}
                className={`w-full py-3 rounded-xl font-bold transition-all shadow-lg flex items-center justify-center gap-2 ${
                  userProfile?.subscriptionStatus === 'business'
                    ? 'bg-green-500/20 text-green-400 border border-green-500/30 cursor-default' 
                    : 'bg-purple-500 text-white hover:bg-purple-600 shadow-purple-500/20'
                }`}
              >
                {isUpgrading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : userProfile?.subscriptionStatus === 'business' ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : (
                  <Wallet className="w-4 h-4" />
                )}
                {userProfile?.subscriptionStatus === 'business' ? 'Đã kích hoạt' : 'Nâng cấp ngay'}
              </button>
              
              <div className="flex items-center justify-center gap-4 opacity-40 grayscale hover:grayscale-0 transition-all">
                <img src="https://upload.wikimedia.org/wikipedia/vi/f/fe/MoMo_Logo.png" alt="Momo" className="h-6" />
                <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/b/b5/ZaloPay_Logo.png/1200px-ZaloPay_Logo.png" alt="ZaloPay" className="h-4" />
              </div>
            </div>
          </div>
        </div>
          {activeTab === 'creative' && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
              <div className="relative group">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Mô tả hình ảnh hoặc video bạn muốn tạo (Ví dụ: Một phi hành gia cưỡi ngựa trên sao Hỏa)..."
                  className="w-full h-40 bg-white/5 border border-white/10 rounded-3xl p-8 text-lg focus:outline-none focus:ring-2 focus:ring-orange-500/50 transition-all resize-none placeholder:text-white/20"
                />
                <div className="absolute bottom-6 right-6 flex gap-3">
                  <button 
                    disabled={isGenerating || isGeneratingVideo || !prompt}
                    onClick={generateImage}
                    className="flex items-center gap-2 px-8 py-4 bg-white text-black rounded-2xl font-bold hover:bg-white/90 disabled:opacity-50 transition-all shadow-xl"
                  >
                    {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <ImageIcon className="w-5 h-5" />}
                    Tạo Ảnh
                  </button>
                  <button 
                    disabled={isGenerating || isGeneratingVideo || !prompt}
                    onClick={generateVideo}
                    className="flex items-center gap-2 px-8 py-4 bg-orange-500 text-white rounded-2xl font-bold hover:bg-orange-600 disabled:opacity-50 transition-all shadow-xl shadow-orange-500/20"
                  >
                    {isGeneratingVideo ? <Loader2 className="w-5 h-5 animate-spin" /> : <Video className="w-5 h-5" />}
                    Tạo Video
                  </button>
                </div>
              </div>

              {/* Results */}
              <AnimatePresence mode="wait">
                {videoStatus && (
                  <motion.div 
                    key="video-status"
                    initial={{ opacity: 0 }} 
                    animate={{ opacity: 1 }} 
                    className="p-4 rounded-2xl bg-orange-500/10 border border-orange-500/20 text-orange-400 text-sm flex items-center gap-3"
                  >
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {videoStatus}
                  </motion.div>
                )}
                {error && (
                  <motion.div 
                    key="error-message"
                    initial={{ opacity: 0 }} 
                    animate={{ opacity: 1 }} 
                    className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-3"
                  >
                    <AlertCircle className="w-4 h-4" />
                    {error}
                  </motion.div>
                )}
                <div key="results-grid" className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {generatedImageUrl && (
                    <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="relative group rounded-3xl overflow-hidden border border-white/10">
                      <img src={generatedImageUrl} alt="AI" className="w-full h-auto" referrerPolicy="no-referrer" />
                      <div className="absolute top-4 right-4 flex gap-2">
                        <button onClick={() => { const a = document.createElement('a'); a.href = generatedImageUrl; a.download = 'ai-image.png'; a.click(); }} className="p-2 bg-black/40 backdrop-blur-md rounded-lg hover:bg-black/60 transition-all">
                          <Download className="w-5 h-5" />
                        </button>
                      </div>
                    </motion.div>
                  )}
                  {generatedVideoUrl && (
                    <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="relative group rounded-3xl overflow-hidden border border-white/10">
                      <video src={generatedVideoUrl} controls className="w-full h-auto" />
                      <div className="absolute top-4 right-4">
                        <button onClick={() => { const a = document.createElement('a'); a.href = generatedVideoUrl; a.download = 'ai-video.mp4'; a.click(); }} className="p-2 bg-black/40 backdrop-blur-md rounded-lg hover:bg-black/60 transition-all">
                          <Download className="w-5 h-5" />
                        </button>
                      </div>
                    </motion.div>
                  )}
                </div>
              </AnimatePresence>
            </motion.div>
          )}

          {activeTab === 'intelligence' && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-2 space-y-4">
                  <div className="bg-white/5 border border-white/10 rounded-3xl p-6 min-h-[400px] max-h-[600px] overflow-y-auto">
                    {chatResponse ? (
                      <div className="prose prose-invert max-w-none">
                        <Markdown>{chatResponse}</Markdown>
                      </div>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-white/20 gap-4">
                        <MessageSquare className="w-12 h-12" />
                        <p>Bắt đầu cuộc hội thoại hoặc yêu cầu phân tích dữ liệu...</p>
                      </div>
                    )}
                  </div>
                    <div className="flex gap-3">
                      <label className="cursor-pointer p-4 bg-white/5 border border-white/10 rounded-2xl hover:bg-white/10 transition-all flex items-center justify-center" title="Tải lên file dữ liệu (CSV, JSON, TXT)">
                        <input type="file" className="hidden" onChange={handleFileUpload} accept=".csv,.json,.txt" />
                        <Layers className={`w-5 h-5 ${analysisFile ? 'text-orange-500' : 'text-white/40'}`} />
                      </label>
                      <input
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleChat()}
                        placeholder="Hỏi bất cứ điều gì hoặc dán dữ liệu cần phân tích..."
                        className="flex-1 bg-white/5 border border-white/10 rounded-2xl px-6 py-4 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                      />
                      <button 
                        onClick={handleChat}
                        disabled={isChatting || !chatInput}
                        className="px-6 py-4 bg-orange-500 text-white rounded-2xl font-bold hover:bg-orange-600 disabled:opacity-50 transition-all"
                      >
                        {isChatting ? <Loader2 className="w-5 h-5 animate-spin" /> : <ChevronRight className="w-5 h-5" />}
                      </button>
                    </div>
                    {analysisFile && (
                      <div className="mt-2 text-[10px] text-orange-500 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        Đã tải lên: {analysisFile.name}
                      </div>
                    )}
                  </div>
                <div className="space-y-4">
                  <div className="p-6 bg-white/5 border border-white/10 rounded-3xl">
                    <h4 className="font-bold mb-4 flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-orange-500" />
                      Công cụ Phân tích
                    </h4>
                    <div className="space-y-2">
                      {['Tóm tắt văn bản', 'Phân tích xu hướng', 'Trích xuất dữ liệu', 'Kiểm tra lỗi logic'].map((tool) => (
                        <button 
                          key={tool}
                          onClick={() => setChatInput(`${tool}: `)}
                          className="w-full text-left px-4 py-2 rounded-xl hover:bg-white/5 text-sm text-white/60 hover:text-white transition-all"
                        >
                          {tool}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'multimedia' && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl mx-auto space-y-8">
              <div className="flex gap-2 bg-white/5 p-1 rounded-2xl border border-white/10 w-fit mx-auto">
                <button onClick={() => setAudioMode('music')} className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${audioMode === 'music' ? 'bg-white text-black' : 'text-white/40'}`}>Âm nhạc</button>
                <button onClick={() => setAudioMode('speech')} className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${audioMode === 'speech' ? 'bg-white text-black' : 'text-white/40'}`}>Giọng nói</button>
              </div>

              <div className="space-y-6 text-center">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={audioMode === 'music' ? "Mô tả bản nhạc bạn muốn (Ví dụ: Nhạc Lo-fi thư giãn cho buổi tối)..." : "Nhập văn bản bạn muốn chuyển thành giọng nói..."}
                  className="w-full h-32 bg-white/5 border border-white/10 rounded-3xl p-6 text-center text-lg focus:outline-none focus:ring-2 focus:ring-orange-500/50 resize-none"
                />
                <button 
                  onClick={generateAudio}
                  disabled={isGeneratingAudio || !prompt}
                  className="px-12 py-4 bg-white text-black rounded-2xl font-bold hover:bg-white/90 disabled:opacity-50 transition-all shadow-xl"
                >
                  {isGeneratingAudio ? <Loader2 className="w-5 h-5 animate-spin" /> : (audioMode === 'music' ? <Music className="w-5 h-5 inline mr-2" /> : <Mic className="w-5 h-5 inline mr-2" />)}
                  {audioMode === 'music' ? 'Tạo Bản Nhạc' : 'Chuyển Thành Giọng Nói'}
                </button>
              </div>

              {audioUrl && (
                <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="p-8 bg-white/5 border border-white/10 rounded-3xl flex flex-col items-center gap-6">
                  <div className="w-20 h-20 bg-orange-500/20 rounded-full flex items-center justify-center">
                    <Play className="w-8 h-8 text-orange-500" />
                  </div>
                  <audio src={audioUrl} controls className="w-full" />
                  <button onClick={() => { const a = document.createElement('a'); a.href = audioUrl; a.download = 'ai-audio.wav'; a.click(); }} className="flex items-center gap-2 text-sm font-bold text-white/40 hover:text-white transition-all">
                    <Download className="w-4 h-4" /> Tải về máy
                  </button>
                </motion.div>
              )}
            </motion.div>
          )}

          {activeTab === 'developer' && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="space-y-4">
                  <div className="p-6 bg-white/5 border border-white/10 rounded-3xl">
                    <h4 className="font-bold mb-4 flex items-center gap-2">
                      <Box className="w-4 h-4 text-blue-400" />
                      3D & Animation
                    </h4>
                    <div className="space-y-2">
                      <button onClick={() => generateCode('threejs')} className="w-full text-left px-4 py-2 rounded-xl hover:bg-white/5 text-sm text-white/60 hover:text-white transition-all flex items-center justify-between">
                        Three.js Scene <ChevronRight className="w-3 h-3" />
                      </button>
                      <button onClick={() => generateCode('blender')} className="w-full text-left px-4 py-2 rounded-xl hover:bg-white/5 text-sm text-white/60 hover:text-white transition-all flex items-center justify-between">
                        Blender Script <ChevronRight className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  <div className="p-6 bg-white/5 border border-white/10 rounded-3xl">
                    <h4 className="font-bold mb-4 flex items-center gap-2">
                      <Share2 className="w-4 h-4 text-green-400" />
                      Kết nối Hệ thống
                    </h4>
                    <p className="text-[10px] text-white/40 mb-4">Sử dụng AIService để tích hợp các tính năng AI vào ứng dụng của bạn.</p>
                    <button 
                      onClick={() => {
                        const doc = `
// Hướng dẫn tích hợp AIService
import { AIService } from './services/aiService';

const ai = new AIService({ 
  apiKey: 'YOUR_GEMINI_API_KEY',
  userId: 'USER_ID_FOR_CREDITS' // Tùy chọn
});

// Ví dụ: Tạo ảnh
const imageUrl = await ai.generateImage('Một con mèo phi hành gia');

// Ví dụ: Chat/Phân tích
const response = await ai.chat('Phân tích dữ liệu này...');
                        `;
                        setCodeResponse(doc.trim());
                        setCodeType('threejs');
                      }}
                      className="w-full py-2 bg-green-500/20 text-green-400 rounded-xl text-xs font-bold hover:bg-green-500/30 transition-all"
                    >
                      Xem Tài liệu SDK
                    </button>
                    <button 
                      onClick={() => {
                        const doc = `
# Hướng dẫn Tích hợp Thanh toán & API Cá nhân

Để cho phép người dùng trong dự án của bạn sử dụng API Key riêng hoặc trả phí:

1. Lưu trữ API Key (Firestore):
Người dùng nhập key trong UI -> Gọi updateCustomApiKeyInFirestore(uid, key).
Key này được lưu an toàn trong document 'users/{uid}'.

2. Luồng Thanh toán (Stripe):
- Frontend: Gọi /api/create-checkout-session với userId.
- Backend (server.ts): Tạo Stripe Session và trả về URL.
- Webhook: Khi thanh toán thành công, Stripe gửi tín hiệu về /api/webhook.
- Cập nhật: Webhook tìm userId và cập nhật 'subscriptionStatus' trong Firestore.

3. Sử dụng API Key trong AI Call:
Khi thực hiện tác vụ AI, hãy ưu tiên lấy 'customApiKey' từ hồ sơ người dùng:
const effectiveKey = userProfile.customApiKey || DEFAULT_API_KEY;
const ai = new GoogleGenAI({ apiKey: effectiveKey });
                        `;
                        setCodeResponse(doc.trim());
                        setCodeType('threejs');
                      }}
                      className="w-full py-2 mt-2 bg-blue-500/20 text-blue-400 rounded-xl text-xs font-bold hover:bg-blue-500/30 transition-all"
                    >
                      Luồng Thanh toán & API
                    </button>
                  </div>
                </div>
                <div className="md:col-span-3 space-y-4">
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Mô tả mô hình 3D hoặc chuyển động bạn muốn tạo mã (Ví dụ: Một khối lập phương xoay 3D với hiệu ứng ánh sáng)..."
                    className="w-full h-24 bg-white/5 border border-white/10 rounded-3xl p-6 focus:outline-none focus:ring-2 focus:ring-blue-500/50 resize-none"
                  />
                  <div className="bg-[#1e1e1e] border border-white/10 rounded-3xl p-6 min-h-[400px] font-mono text-sm overflow-x-auto relative group">
                    {isGeneratingCode && (
                      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center rounded-3xl z-10">
                        <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
                      </div>
                    )}
                    
                    {previewCode ? (
                      <div className="absolute inset-0 rounded-3xl overflow-hidden">
                        <iframe 
                          srcDoc={previewCode} 
                          className="w-full h-full border-none"
                          title="Three.js Preview"
                        />
                        <button 
                          onClick={() => setPreviewCode(null)}
                          className="absolute top-4 right-4 px-3 py-1.5 bg-black/60 backdrop-blur-md text-white rounded-lg text-xs font-bold hover:bg-black/80"
                        >
                          Đóng Preview
                        </button>
                      </div>
                    ) : codeResponse ? (
                      <pre className="text-blue-300"><code>{codeResponse}</code></pre>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-white/10 gap-4">
                        <Code2 className="w-12 h-12" />
                        <p>Mã nguồn AI sẽ xuất hiện tại đây...</p>
                      </div>
                    )}
                    
                    {codeResponse && !previewCode && (
                      <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-all">
                        {codeType === 'threejs' && (
                          <button 
                            onClick={runPreview}
                            className="p-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-all"
                            title="Xem trước 3D"
                          >
                            <Play className="w-4 h-4" />
                          </button>
                        )}
                        <button 
                          onClick={() => copyToClipboard(codeResponse)} 
                          className="p-2 bg-white/5 hover:bg-white/10 rounded-lg transition-all"
                          title="Sao chép mã"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <MainApp />
  );
}
