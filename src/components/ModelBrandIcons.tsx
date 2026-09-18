import React from "react";

interface ModelLogoProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

// 1. Anthropic Claude Official Multi-Spoke Starburst Logo (Exact match to Image 1)
export function ClaudeLogo({ size = 18, style }: ModelLogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" style={style}>
      <rect width="48" height="48" rx="10" fill="#D97757" />
      <g fill="#FAF4EE">
        {/* Core Hub */}
        <circle cx="24" cy="24" r="6" />
        {/* Ray 1: Top-Left Upper (~115°) */}
        <path d="M22.5 24L15.5 8.5C15 7.4 16.5 6.5 17.5 7.5L24.5 22.5Z" />
        {/* Ray 2: Top Central (~85°) */}
        <path d="M23 24L26 8C26.3 6.8 28 6.8 28.3 8L26 24Z" />
        {/* Ray 3: Top-Right High (~50°) */}
        <path d="M24 23L35.5 11C36.4 10.1 37.7 11.4 36.8 12.3L25.5 25Z" />
        {/* Ray 4: Right Upper (~15°) */}
        <path d="M24 23.5L40 21C41.2 20.8 41.5 22.5 40.3 23L24.5 25.5Z" />
        {/* Ray 5: Right Lower (~-10°) */}
        <path d="M24 24.5L40.5 27C41.7 27.2 41.6 28.9 40.4 29.3L24.5 26.5Z" />
        {/* Ray 6: Bottom-Right (~-40°) */}
        <path d="M24 25L36.5 35.5C37.4 36.3 36.2 37.6 35.3 36.8L23.5 26Z" />
        {/* Ray 7: Bottom-Right Low (~-70°) */}
        <path d="M24 25L31.5 38.5C32.1 39.5 30.6 40.5 29.8 39.5L23 26Z" />
        {/* Ray 8: Bottom Central (~-95°) */}
        <path d="M23.5 25L23 41C23 42.2 21.2 42.2 21 41L22.5 25Z" />
        {/* Ray 9: Bottom-Left (~-130°) */}
        <path d="M23 25L15 38C14.3 39 12.8 38 13.5 37L22 24.5Z" />
        {/* Ray 10: Bottom-Left Flat (~-150°) */}
        <path d="M23 24.5L10 33C9 33.7 8.2 32.2 9.2 31.4L22 23.5Z" />
        {/* Ray 11: Left Flat (~180°) */}
        <path d="M23 23.5L7 24C5.8 24 5.8 22.2 7 22.2L23 22.5Z" />
        {/* Ray 12: Left Upper (~145°) */}
        <path d="M23 23L9.5 14C8.6 13.4 9.6 12 10.6 12.7L23.5 22Z" />
      </g>
    </svg>
  );
}

// 2. DeepSeek Official Whale Logo (Exact match to Image 2)
export function DeepSeekLogo({ size = 18, style }: ModelLogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" style={style}>
      <defs>
        <linearGradient id="ds-brand-blue" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#4D6BFE" />
          <stop offset="100%" stopColor="#1E40AF" />
        </linearGradient>
      </defs>
      {/* Whale Body */}
      <path
        d="M50 18C30 18 18 32 18 52C18 72 32 82 52 82C62 82 72 76 78 68C76 66 73 63 68 62C58 60 52 52 54 42C55 35 60 30 67 28C72 26 77 28 80 32C84 25 82 18 76 18C70 18 68 22 64 24C60 21 55 18 50 18Z"
        fill="url(#ds-brand-blue)"
      />
      {/* Whale Tail Fluke */}
      <path
        d="M74 20C78 12 88 15 90 22C86 26 80 27 75 33C71 28 72 23 74 20Z"
        fill="url(#ds-brand-blue)"
      />
      {/* Belly Arc & Eye Notch */}
      <path
        d="M24 50C24 64 34 74 48 74C34 74 26 62 26 50C26 38 35 28 48 26C32 28 24 38 24 50Z"
        fill="#93C5FD"
      />
      {/* Whale Eye */}
      <circle cx="58" cy="36" r="3" fill="#FFFFFF" />
      <circle cx="59" cy="36" r="1.5" fill="#1E3A8A" />
    </svg>
  );
}

// 3. OpenAI / ChatGPT Official Rosette Logo (Exact match to Image 3)
export function OpenAILogo({ size = 18, style }: ModelLogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <path
        d="M22.28 9.68a5.55 5.55 0 0 0-.48-4.63 5.64 5.64 0 0 0-4.04-2.69 5.67 5.67 0 0 0-4.88 1.17 5.64 5.64 0 0 0-3.64-.17 5.63 5.63 0 0 0-3.32 2.65 5.65 5.65 0 0 0-.82 4.6 5.63 5.63 0 0 0-2.4 3.73 5.66 5.66 0 0 0 .76 4.6 5.64 5.64 0 0 0 4.05 2.69 5.62 5.62 0 0 0 4.88-1.17 5.62 5.62 0 0 0 3.63.17 5.64 5.64 0 0 0 3.32-2.65 5.66 5.66 0 0 0 .82-4.6 5.63 5.63 0 0 0 2.4-3.73 5.66 5.66 0 0 0-.76-4.6zM13.6 21.6a4.13 4.13 0 0 1-2.9-1.22l.14-.08 4.79-2.77a.8.8 0 0 0 .4-.69v-6.75l2.02 1.17a.08.08 0 0 1 .04.06v5.54a4.15 4.15 0 0 1-4.49 4.74zm-9.33-4.22a4.14 4.14 0 0 1-.54-3.11 4.18 4.18 0 0 1 1.67-2.66l.14.08 4.79 2.76a.79.79 0 0 0 .8 0l5.85-3.38v2.33a.08.08 0 0 1-.03.07l-4.8 2.77a4.15 4.15 0 0 1-7.88 1.14zm-1.42-9.45a4.14 4.14 0 0 1 2.37-1.89 4.18 4.18 0 0 1 3.12.24l-.14.08-4.79 2.77a.8.8 0 0 0-.4.69v6.75l-2.02-1.17a.08.08 0 0 1-.04-.07V9.47a4.07 4.07 0 0 1 1.9-1.54zm14.4 3.6-5.85 3.38-5.85-3.38 5.85-3.38 5.85 3.38zm-1.85-7.46a4.15 4.15 0 0 1 2.9 1.22l-.14.08-4.79 2.77a.8.8 0 0 0-.4.69v6.75l-2.02-1.17a.08.08 0 0 1-.04-.06V8.12a4.15 4.15 0 0 1 4.49-4.74zm7.91 5.23a4.14 4.14 0 0 1 .54 3.11 4.18 4.18 0 0 1-1.67 2.66l-.14-.08-4.79-2.77a.79.79 0 0 0-.8 0l-5.85 3.38v-2.33a.08.08 0 0 1 .03-.07l4.8-2.77a4.15 4.15 0 0 1 7.88-1.13z"
        fill="#10A37F"
      />
    </svg>
  );
}

// 4. Groq Official Wordmark / Geometric "g" Emblem (Exact match to Image 4)
export function GroqLogo({ size = 18, style }: ModelLogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={style}>
      <defs>
        <linearGradient id="groq-orange-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FF4F00" />
          <stop offset="100%" stopColor="#EA580C" />
        </linearGradient>
      </defs>
      {/* Groq Circular "g" Glyph */}
      <path
        d="M32 8C18.7 8 8 18.7 8 32C8 45.3 18.7 56 32 56C38.2 56 43.8 53.6 48 49.7V56H56V26H32V34H47.4C45.2 41 39.2 46 32 46C24.3 46 18 39.7 18 32C18 24.3 24.3 18 32 18C36.4 18 40.3 20 43 23.2L49.5 16.7C45.2 11.4 39 8 32 8Z"
        fill="url(#groq-orange-grad)"
      />
    </svg>
  );
}

// 5. Google Gemini Official 4-point Diamond Sparkle (Prismatic Gradient)
export function GeminiLogo({ size = 18, style }: ModelLogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <defs>
        <linearGradient id="gemini-grad-v3" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#4E82EE" />
          <stop offset="40%" stopColor="#8B5CF6" />
          <stop offset="75%" stopColor="#EC4899" />
          <stop offset="100%" stopColor="#F59E0B" />
        </linearGradient>
      </defs>
      <path
        d="M12 0C12 6.627 6.627 12 0 12C6.627 12 12 17.373 12 24C12 17.373 17.373 12 24 12C17.373 12 12 6.627 12 0Z"
        fill="url(#gemini-grad-v3)"
      />
    </svg>
  );
}

// 6. Meta LLaMA Official Logo (Meta Royal Blue Ribbon)
export function MetaLogo({ size = 18, style }: ModelLogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <defs>
        <linearGradient id="meta-grad-v3" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0081FB" />
          <stop offset="50%" stopColor="#0064E0" />
          <stop offset="100%" stopColor="#0052CC" />
        </linearGradient>
      </defs>
      <path
        d="M17.48 4.21C16.09 4.21 14.77 4.87 13.7 6.08C12.81 4.88 11.64 4.21 10.29 4.21C7.38 4.21 4.96 6.88 4.96 10.89C4.96 15.53 8.39 19.79 12 19.79C15.61 19.79 19.04 15.53 19.04 10.89C19.04 6.88 18.87 4.21 17.48 4.21ZM12 17.65C9.36 17.65 7.15 14.43 7.15 10.89C7.15 8.1 8.54 6.35 10.29 6.35C11.38 6.35 12.37 7.24 13.06 8.87C12.56 9.87 12.22 11.02 12.22 12.18C12.22 13.08 12.44 13.92 12.85 14.65C12.63 16.48 12.34 17.65 12 17.65ZM16.85 10.89C16.85 14.43 14.64 17.65 12 17.65C11.83 17.65 11.66 17.61 11.5 17.54C11.08 16.92 10.85 16.14 10.85 15.28C10.85 14.15 11.23 13.04 11.85 12C12.43 10.99 13.23 10.15 14.18 9.57C15.82 8.57 16.85 9.47 16.85 10.89Z"
        fill="url(#meta-grad-v3)"
      />
    </svg>
  );
}

// 7. Qwen / Alibaba Official Violet Prismatic Logo
export function QwenLogo({ size = 18, style }: ModelLogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <defs>
        <linearGradient id="qwen-grad-v3" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#8B5CF6" />
          <stop offset="100%" stopColor="#6366F1" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="20" height="20" rx="6" fill="url(#qwen-grad-v3)" />
      <path
        d="M12 6L17 9.5V14.5L12 18L7 14.5V9.5L12 6Z"
        stroke="#FFFFFF"
        strokeWidth="1.8"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="12" cy="12" r="2.2" fill="#FFFFFF" />
    </svg>
  );
}

// 8. Mistral AI Official Stepped Cascading Bars
export function MistralLogo({ size = 18, style }: ModelLogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <rect x="2" y="2" width="20" height="20" rx="5" fill="#FF7000" />
      <rect x="5.5" y="6" width="3" height="3" fill="#FFFFFF" />
      <rect x="15.5" y="6" width="3" height="3" fill="#FFFFFF" />
      <rect x="5.5" y="10.5" width="13" height="3" fill="#FFFFFF" />
      <rect x="5.5" y="15" width="4.5" height="3" fill="#FFFFFF" />
      <rect x="14" y="15" width="4.5" height="3" fill="#FFFFFF" />
    </svg>
  );
}

// 9. OpenRouter Official Hexagonal Node Cluster Logo
export function OpenRouterLogo({ size = 18, style }: ModelLogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <defs>
        <linearGradient id="or-grad-v3" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#7C3AED" />
          <stop offset="100%" stopColor="#4F46E5" />
        </linearGradient>
      </defs>
      <path
        d="M12 2L20.66 7V17L12 22L3.34 17V7L12 2Z"
        fill="url(#or-grad-v3)"
      />
      <path
        d="M12 6L17 9V15L12 18L7 15V9L12 6Z"
        fill="#0F172A"
      />
      <circle cx="12" cy="12" r="2.5" fill="#A78BFA" />
      <line x1="12" y1="6" x2="12" y2="9.5" stroke="#A78BFA" strokeWidth="1.5" />
      <line x1="17" y1="15" x2="14" y2="13.5" stroke="#A78BFA" strokeWidth="1.5" />
      <line x1="7" y1="15" x2="10" y2="13.5" stroke="#A78BFA" strokeWidth="1.5" />
    </svg>
  );
}

// 10. Ollama Official Mascot Logo
export function OllamaLogo({ size = 18, style }: ModelLogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <rect x="2" y="2" width="20" height="20" rx="5" fill="#1E293B" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
      <circle cx="9" cy="9" r="1.5" fill="#FFFFFF" />
      <circle cx="15" cy="9" r="1.5" fill="#FFFFFF" />
      <ellipse cx="12" cy="14" rx="3.5" ry="2.2" fill="#38BDF8" />
    </svg>
  );
}

// 11. GLM / Zhipu AI Official Logo
export function GLMLogo({ size = 18, style }: ModelLogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <defs>
        <linearGradient id="glm-grad-v3" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#06B6D4" />
          <stop offset="100%" stopColor="#3B82F6" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="20" height="20" rx="6" fill="url(#glm-grad-v3)" />
      <path
        d="M7 8.5C7 7.67 7.67 7 8.5 7H15.5C16.33 7 17 7.67 17 8.5V10.5H10V13.5H14.5V15.5H8.5C7.67 15.5 7 14.83 7 14V8.5Z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

// 12. Poolside Official Logo
export function PoolsideLogo({ size = 18, style }: ModelLogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <rect x="2" y="2" width="20" height="20" rx="5" fill="#0EA5E9" />
      <path
        d="M6 10C7.5 8.8 9.5 8.8 11 10C12.5 11.2 14.5 11.2 16 10C17.5 8.8 18.5 9.2 19 10"
        stroke="#FFFFFF"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M6 14C7.5 12.8 9.5 12.8 11 14C12.5 15.2 14.5 15.2 16 14C17.5 12.8 18.5 13.2 19 14"
        stroke="#FFFFFF"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

// 13. xAI / Grok Official Logo
export function GrokLogo({ size = 18, style }: ModelLogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <rect x="2" y="2" width="20" height="20" rx="5" fill="#000000" stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
      <path
        d="M16.5 6.5L12.8 11.8L17.5 17.5H15.5L11.8 13.1L8.2 17.5H6.5L10.5 12.6L6.5 6.5H8.5L11.5 10.5L14.8 6.5H16.5Z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

// 14. Cohere Official Coral Logo
export function CohereLogo({ size = 18, style }: ModelLogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <rect x="2" y="2" width="20" height="20" rx="5" fill="#39594C" />
      <circle cx="8.5" cy="12" r="3.5" fill="#D1345B" />
      <circle cx="15.5" cy="12" r="3.5" fill="#FFB154" />
    </svg>
  );
}

// 15. Microsoft Official 4-Tile Logo
export function MicrosoftLogo({ size = 18, style }: ModelLogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <rect x="3" y="3" width="8.5" height="8.5" fill="#F25022" />
      <rect x="12.5" y="3" width="8.5" height="8.5" fill="#7FBA00" />
      <rect x="3" y="12.5" width="8.5" height="8.5" fill="#00A4EF" />
      <rect x="12.5" y="12.5" width="8.5" height="8.5" fill="#FFB900" />
    </svg>
  );
}

// 16. Perplexity AI Official Cyan Knot Logo
export function PerplexityLogo({ size = 18, style }: ModelLogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <rect x="2" y="2" width="20" height="20" rx="5" fill="#171C26" stroke="#22D3EE" strokeWidth="1" />
      <path
        d="M12 4V20M4 12H20M6.5 6.5L17.5 17.5M17.5 6.5L6.5 17.5"
        stroke="#22D3EE"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

// 17. NVIDIA Official Neon Eye Logo
export function NvidiaLogo({ size = 18, style }: ModelLogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <rect x="2" y="2" width="20" height="20" rx="5" fill="#000000" />
      <path
        d="M12 5C7 5 3.5 8.5 3 13C4 10.5 7.5 9 12 9C15.5 9 18 10.5 19 12C18.5 8 15.5 5 12 5ZM12 11C8.5 11 6.5 12.5 6 14.5C7 13.5 9 13 12 13C14.5 13 16 13.5 16.5 14.5C16 12 14.5 11 12 11ZM12 15C10 15 8.8 15.6 8.5 16.5C9.2 16.2 10.5 16 12 16C13.2 16 14.2 16.2 14.8 16.5C14.5 15.6 13.5 15 12 15Z"
        fill="#76B900"
      />
    </svg>
  );
}

// 18. Stealth OX Alpha Cyber Logo
export function StealthLogo({ size = 18, style }: ModelLogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <defs>
        <linearGradient id="stealth-grad-v3" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#EC4899" />
          <stop offset="100%" stopColor="#8B5CF6" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="20" height="20" rx="5" fill="#180B26" stroke="#EC4899" strokeWidth="1" />
      <path
        d="M6 7L9 11L12 8L15 11L18 7L16 15L12 18L8 15L6 7Z"
        fill="url(#stealth-grad-v3)"
      />
      <circle cx="10" cy="12" r="1" fill="#FFFFFF" />
      <circle cx="14" cy="12" r="1" fill="#FFFFFF" />
    </svg>
  );
}

/**
 * Universal Brand Resolver: dynamically returns the exact vector SVG logo
 * for any model based on its model ID, model display name, or provider string.
 */
export function getModelBrandLogo(
  modelId: string = "",
  modelName: string = "",
  provider: string = "",
  size: number = 18
): React.ReactNode {
  const target = `${modelId} ${modelName} ${provider}`.toLowerCase();

  if (target.includes("gemini") || target.includes("google") || target.includes("gemma")) {
    return <GeminiLogo size={size} />;
  }
  if (target.includes("gpt") || target.includes("openai") || target.includes("o1") || target.includes("o3") || target.includes("o4") || target.includes("chatgpt")) {
    return <OpenAILogo size={size} />;
  }
  if (target.includes("claude") || target.includes("anthropic") || target.includes("sonnet") || target.includes("haiku") || target.includes("opus")) {
    return <ClaudeLogo size={size} />;
  }
  if (target.includes("deepseek") || target.includes("r1") || target.includes("deepseek-r1") || target.includes("deepseek-chat")) {
    return <DeepSeekLogo size={size} />;
  }
  if (target.includes("llama") || target.includes("meta")) {
    return <MetaLogo size={size} />;
  }
  if (target.includes("qwen") || target.includes("qwq") || target.includes("alibaba")) {
    return <QwenLogo size={size} />;
  }
  if (target.includes("mistral") || target.includes("codestral") || target.includes("pixtral") || target.includes("nemo")) {
    return <MistralLogo size={size} />;
  }
  if (target.includes("grok") || target.includes("x-ai") || target.includes("xai")) {
    return <GrokLogo size={size} />;
  }
  if (target.includes("groq")) {
    return <GroqLogo size={size} />;
  }
  if (target.includes("glm") || target.includes("zhipu") || target.includes("chatglm")) {
    return <GLMLogo size={size} />;
  }
  if (target.includes("cohere") || target.includes("command-r")) {
    return <CohereLogo size={size} />;
  }
  if (target.includes("microsoft") || target.includes("phi-") || target.includes("wizardlm")) {
    return <MicrosoftLogo size={size} />;
  }
  if (target.includes("perplexity") || target.includes("sonar")) {
    return <PerplexityLogo size={size} />;
  }
  if (target.includes("nvidia") || target.includes("nemotron")) {
    return <NvidiaLogo size={size} />;
  }
  if (target.includes("stealth") || target.includes("ox-alpha") || target.includes("ox alpha")) {
    return <StealthLogo size={size} />;
  }
  if (target.includes("ollama")) {
    return <OllamaLogo size={size} />;
  }
  if (target.includes("openrouter")) {
    return <OpenRouterLogo size={size} />;
  }
  if (target.includes("poolside")) {
    return <PoolsideLogo size={size} />;
  }

  return <OpenRouterLogo size={size} />;
}
