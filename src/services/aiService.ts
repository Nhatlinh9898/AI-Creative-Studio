import { GoogleGenAI, Modality, GenerateContentResponse } from "@google/genai";
import { deductCredits } from "./userService";

export interface AIServiceConfig {
  apiKey: string;
  userId?: string;
}

export class AIService {
  private ai: GoogleGenAI;
  private userId?: string;

  constructor(config: AIServiceConfig) {
    this.ai = new GoogleGenAI({ apiKey: config.apiKey });
    this.userId = config.userId;
  }

  private async checkAndDeductCredits(amount: number) {
    if (this.userId) {
      const hasCredits = await deductCredits(this.userId, amount);
      if (!hasCredits) {
        throw new Error("Bạn không đủ credit để thực hiện thao tác này. Vui lòng nạp thêm.");
      }
    }
  }

  /**
   * Tạo hình ảnh từ văn bản
   */
  async generateImage(prompt: string, aspectRatio: "1:1" | "3:4" | "4:3" | "9:16" | "16:9" = "1:1") {
    await this.checkAndDeductCredits(1);
    
    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [{ text: prompt }],
        },
        config: {
          imageConfig: {
            aspectRatio,
          }
        }
      });

      const candidate = response.candidates?.[0];
      if (candidate) {
        for (const part of candidate.content?.parts || []) {
          if (part.inlineData) {
            return `data:image/png;base64,${part.inlineData.data}`;
          }
          if (part.text) {
            console.warn("AI text response instead of image:", part.text);
          }
        }
      }
    } catch (err) {
      console.warn("Lỗi với gemini-2.5-flash-image, thử Imagen 4.0:", err);
    }

    // Thử Imagen 4.0 làm fallback
    try {
      const response = await this.ai.models.generateImages({
        model: 'imagen-4.0-generate-001',
        prompt: prompt,
        config: {
          numberOfImages: 1,
          aspectRatio: aspectRatio as any,
        },
      });

      const imageBytes = response.generatedImages?.[0]?.image?.imageBytes;
      if (imageBytes) {
        return `data:image/png;base64,${imageBytes}`;
      }
    } catch (err) {
      console.error("Lỗi với Imagen 4.0:", err);
    }

    throw new Error("Không tìm thấy dữ liệu hình ảnh trong phản hồi từ cả hai mô hình.");
  }

  /**
   * Tạo video từ văn bản (Yêu cầu API Key cá nhân có bật thanh toán)
   */
  async generateVideo(prompt: string, onStatusUpdate?: (status: string) => void) {
    await this.checkAndDeductCredits(10);
    
    let operation = await this.ai.models.generateVideos({
      model: 'veo-3.1-fast-generate-preview',
      prompt: prompt,
      config: {
        numberOfVideos: 1,
        resolution: '720p',
        aspectRatio: '16:9'
      }
    });

    while (!operation.done) {
      if (onStatusUpdate) onStatusUpdate("AI đang xử lý video (có thể mất 1-2 phút)...");
      await new Promise(resolve => setTimeout(resolve, 10000));
      operation = await this.ai.operations.getVideosOperation({ operation: operation });
    }

    const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
    if (!downloadLink) throw new Error("Không tìm thấy link tải video.");

    const response = await fetch(downloadLink, {
      method: 'GET',
      headers: {
        'x-goog-api-key': (this.ai as any).apiKey,
      },
    });
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  }

  /**
   * Trò chuyện và phân tích dữ liệu
   */
  async chat(input: string, systemInstruction?: string) {
    await this.checkAndDeductCredits(0.1);
    
    const response = await this.ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: input,
      config: {
        systemInstruction: systemInstruction || "Bạn là một chuyên gia phân tích dữ liệu và trợ lý thông minh. Hãy trả lời bằng tiếng Việt, chuyên nghiệp và súc tích."
      }
    });
    return response.text || '';
  }

  /**
   * Tạo âm thanh (Âm nhạc hoặc Giọng nói)
   */
  async generateAudio(prompt: string, mode: 'music' | 'speech') {
    await this.checkAndDeductCredits(mode === 'music' ? 5 : 1);
    
    if (mode === 'music') {
      const response = await this.ai.models.generateContentStream({
        model: "lyria-3-clip-preview",
        contents: prompt,
        config: { responseModalities: [Modality.AUDIO] }
      });

      let audioBase64 = "";
      let mimeType = "audio/wav";

      for await (const chunk of response) {
        const parts = chunk.candidates?.[0]?.content?.parts;
        if (!parts) continue;
        for (const part of parts) {
          if (part.inlineData?.data) {
            if (!audioBase64 && part.inlineData.mimeType) mimeType = part.inlineData.mimeType;
            audioBase64 += part.inlineData.data;
          }
        }
      }

      const binary = atob(audioBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new Blob([bytes], { type: mimeType });
    } else {
      const response = await this.ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } }
        }
      });
      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) throw new Error("Không tạo được giọng nói.");
      
      const binary = atob(base64Audio);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes; // Trả về raw bytes để xử lý WAV header bên ngoài nếu cần
    }
  }

  /**
   * Tạo mã nguồn (Three.js hoặc Blender)
   */
  async generateCode(prompt: string, type: 'threejs' | 'blender') {
    await this.checkAndDeductCredits(2);
    
    const response = await this.ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: `Tạo mã ${type === 'threejs' ? 'Three.js' : 'Blender Python'} cho yêu cầu sau: ${prompt}. Chỉ trả về mã nguồn, không giải thích. Nếu là Three.js, giả sử đã có các biến global: THREE, scene, camera, renderer, và container (là document.body).`,
    });
    return response.text || '';
  }
}
