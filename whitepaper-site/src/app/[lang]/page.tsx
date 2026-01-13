"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { MessageSquare, Cpu, Share2, ArrowRight, Zap, Mail, Layers, Code2, User, Briefcase, Network as NetworkIcon, Globe, Disc as Discord, MessageCircle, Shield, Monitor, X, Beaker } from "lucide-react";

// --- Sub Components ---

const Section = ({ title, children, icon: Icon, stacked = false }: any) => (
  <motion.div 
    initial={{ opacity: 0, y: 20 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true }}
    className="py-16 border-b border-zinc-900 last:border-0"
  >
    <div className="flex items-center gap-3 mb-8">
      <div className="p-2 bg-zinc-900 rounded border border-zinc-800">
        <Icon size={20} className="text-zinc-400" />
      </div>
      <h2 className="text-xl font-bold tracking-tight text-white uppercase tracking-widest">{title}</h2>
    </div>
    <div className={stacked ? "flex flex-col gap-12" : "grid grid-cols-1 md:grid-cols-2 gap-12"}>
      {children}
    </div>
  </motion.div>
);

const MobileWarning = ({ t }: any) => {
  const [visible, setVisible] = useState(false);
  
  useEffect(() => {
    const isMobile = window.innerWidth < 768;
    const isDismissed = sessionStorage.getItem('mobile-warning-dismissed');
    if (isMobile && !isDismissed) setVisible(true);
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div 
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-md flex items-center justify-center p-8 md:hidden text-center"
        >
          <div className="max-w-xs space-y-6">
            <div className="mx-auto w-16 h-16 bg-zinc-900 rounded-2xl border border-zinc-800 flex items-center justify-center text-white shadow-2xl"><Monitor size={32} /></div>
            <div className="space-y-2">
               <h3 className="text-white font-bold uppercase tracking-widest text-sm">Optimal Experience</h3>
               <p className="text-zinc-500 text-xs leading-relaxed">{t.mobile_warn}</p>
            </div>
            <button onClick={() => setVisible(false)} className="w-full py-3 bg-white text-black font-bold rounded-lg text-xs uppercase tracking-tighter">{t.mobile_btn}</button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

// --- Translation Dictionary ---

const CONTENT: any = {
  zh: {
    nav: { demo: "运行 PoC", whitepaper: "白皮书", github: "代码仓" },
    hero: {
      stage: "概念验证阶段 / 协议开发中",
      title: "极简 Multi-Agent 原语",
      subtitle: "如果人类社会可以通过“微信”这种简单的 IM 界面组织起数十亿人的协作，那么 AI Agents 也不应该被锁死在复杂的图结构（DAG）中。",
    },
    belief: {
      text: "传统的多智能体框架通常强迫开发者在静态工作流中预定义每一个节点和连线。我们相信：组织应当是自发演化的，而非被预设的。",
    },
    s1: {
      title: "01. 核心原语",
      h3: "所有的 Multi-Agent 系统，都可以通过两个原语表达。",
      p1: "我们抛弃了冗长的状态机定义，回归最纯粹的沟通逻辑。",
      p2: "通过 create() 可以瞬间雇佣或克隆一个新的 Agent 并获得其唯一的 agent_id。",
      p3: "通过 send() 可以向系统内任何已知的 ID 发送异步消息。这就是 Agent 的全部。",
      api: "核心接口签名",
      usage: "使用示例"
    },
    s2: {
      title: "02. 液态拓扑",
      h3: "由 Agent 自主构建，而非人为预设。",
      p: "传统的 Workflow 是死板的图纸。而在 Agent Wechat 中，拓扑结构是在运行过程中“流”出来的。当 Agent 发现任务过于复杂时，它会自主决定去“雇佣”下属。它是自适应的液态组织，而非僵硬的机械齿轮。",
      old: "静态工作流 (旧)",
      new: "液态拓扑 (Agent Wechat)",
      old_desc: "预设且脆弱",
      new_desc: "自演化与韧性"
    },
    s3: {
      title: "03. 扁平协作",
      h3: "像微信聊天一样，介入任何层级。",
      p: "传统的 Agent 系统是黑盒。但在 Agent Wechat 中，人类拥有全局视角。你可以随时通过统一的 IM 界面，跨越层级直接向任何一个 sub-agent 发起会话。这种扁平化的干预能力，让复杂的 Agent 拓扑变得可观察、可调试、可介入。",
      terminal: "人类协作终端",
      target: "拦截目标节点",
      chat: "等等！改成3D引擎实现。"
    },
    cta: {
      ready: "见证组织智能的诞生",
      desc: "本项目目前处于早期概念验证阶段，实际产品正在紧锣密鼓开发中。关注我们，获取最新进度。",
      btn: "运行交互式概念验证"
    },
    footer: {
      contact: "保持关注",
      wechat_tip: "扫描二维码添加微信",
      proof: "思想起源存证",
      proof_desc: "该想法已永久托管于 Arweave 区块链，确保创意主权不可篡改。",
      discuss: "参与深度讨论",
      wechat_article: "微信公众号专栏",
      zhihu_article: "知乎深度拆解",
      x_post: "X (Twitter) 宣言"
    },
    mobile_warn: "检测到移动端访问。建议在电脑端浏览以获得最佳的交互体验与拓扑视觉效果。",
    mobile_btn: "我知道了，继续浏览"
  },
  en: {
    nav: { demo: "Run PoC", whitepaper: "Whitepaper", github: "GitHub" },
    hero: {
      stage: "POC STAGE / PROTOCOL UNDER DEVELOPMENT",
      title: "MINIMAL PRIMITIVES.",
      subtitle: "If human society can organize billions of people through simple IM interfaces like WeChat, AI Agents should not be locked in complex graph structures (DAGs).",
    },
    belief: {
      text: "Traditional multi-agent frameworks often force developers to pre-define every node and connection in a static workflow. We believe: Organization should be emergent, not prescribed.",
    },
    s1: {
      title: "01. The Primitives",
      h3: "All Multi-Agent systems can be expressed through two primitives.",
      p1: "We discard tedious state machine definitions and return to the purest communication logic.",
      p2: "Through create(), you can instantly hire or clone a new Agent and get its unique agent_id.",
      p3: "Through send(), you can send asynchronous messages to any known ID. That is all an Agent is.",
      api: "Core API Signatures",
      usage: "Usage Example"
    },
    s2: {
      title: "02. Fluid Topology",
      h3: "Built autonomously by Agents, not preset by humans.",
      p: "Traditional workflows are rigid blueprints. In Agent Wechat, topology 'flows' during execution. When an Agent finds a task too complex, it autonomously hires subordinates. It is a liquid organization, not a stiff gear.",
      old: "Static Workflow (Old)",
      new: "Liquid Topology (Agent Wechat)",
      old_desc: "Predefined & Brittle",
      new_desc: "Self-evolving & Resilient"
    },
    s3: {
      title: "03. Direct Collaboration",
      h3: "Intervene at any level, just like chatting.",
      p: "Traditional Agent systems are black boxes. In Agent Wechat, humans have a global perspective. You can start a conversation with any sub-agent directly via IM. This flat intervention makes complex topologies observable, debuggable, and actionable.",
      terminal: "Human Collaboration Term",
      target: "Intervention Point",
      chat: "Wait! Make it 3D instead."
    },
    cta: {
      ready: "Witness the Birth of Org-Intelligence",
      desc: "This project is in its early Proof-of-Concept stage. The core engine is currently under active development. Follow us for updates.",
      btn: "Run Interactive PoC"
    },
    footer: {
      contact: "Stay Updated",
      wechat_tip: "Scan to follow on WeChat",
      proof: "Genesis Proof",
      proof_desc: "This idea is permanently etched on the Arweave blockchain to ensure creative sovereignty.",
      discuss: "Join the Discussion",
      wechat_article: "WeChat Official Article",
      zhihu_article: "Zhihu Technical Breakdown",
      x_post: "X (Twitter) Manifesto"
    },
    mobile_warn: "Mobile device detected. We recommend desktop for the best interactive and visualization experience.",
    mobile_btn: "Got it, continue anyway"
  }
};

// --- Main Page ---

import { useEffect } from 'react';

export default function WhitepaperHome() {
  const params = useParams();
  const lang = (params?.lang as "zh" | "en") || "en";
  const t = CONTENT[lang] || CONTENT.en;
  const router = useRouter();

  const [showWeChat, setShowWeChat] = useState(false);

  const toggleLang = () => {
    const nextLang = lang === "zh" ? "en" : "zh";
    document.cookie = `NEXT_LOCALE=${nextLang}; max-age=31536000; path=/`;
    router.push(`/${nextLang}`);
  };

  return (
    <div className="min-h-screen bg-black text-zinc-400 font-mono selection:bg-white selection:text-black overflow-x-hidden">
      
      <MobileWarning t={t} />

      {/* Navigation */}
      <nav className="fixed top-0 w-full z-50 px-8 h-16 flex items-center justify-between backdrop-blur-md border-b border-white/5 bg-black/50">
        <div className="font-bold text-white tracking-tighter flex items-center gap-2">
          <Cpu size={18} /> AGENT WECHAT
        </div>
        <div className="flex items-center gap-8 text-xs uppercase tracking-widest">
          <div className="hidden md:flex gap-8">
            <Link href="/demo" className="text-zinc-500 hover:text-white transition-colors">{t.nav.demo}</Link>
            <a href="#" className="text-zinc-500 hover:text-white transition-colors">{t.nav.whitepaper}</a>
            <a href="https://github.com/chmod777john/agent-wechat" target="_blank" className="text-zinc-500 hover:text-white transition-colors">{t.nav.github}</a>
          </div>
          <button onClick={toggleLang} className="flex items-center gap-2 px-3 py-1 bg-zinc-900 border border-zinc-800 rounded text-zinc-200 hover:bg-zinc-800 transition-all font-bold">
            <Globe size={14} /> {lang.toUpperCase()}
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="max-w-5xl mx-auto px-8 pt-40 pb-20">
        <motion.div key={lang} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="mb-32">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-500/10 border border-blue-500/20 rounded-full text-[10px] text-blue-400 font-bold uppercase tracking-widest mb-6">
            <Beaker size={12} /> {t.hero.stage}
          </div>
          <h1 className="text-5xl md:text-7xl font-bold text-white mb-6 tracking-tighter leading-none">
            {t.hero.title}<br/>
            <span className="text-red-500">NO MORE LANGGRAPH.</span>
          </h1>
          <p className="max-w-2xl text-lg leading-relaxed mb-10 text-zinc-500">{t.hero.subtitle}</p>
          <div className="flex gap-4">
            <Link href="/demo" className="px-8 py-3 bg-white text-black font-bold hover:bg-zinc-200 transition-all flex items-center gap-2">
              {t.nav.demo} <ArrowRight size={18} />
            </Link>
          </div>
        </motion.div>

        {/* Core Belief Manifesto */}
        <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} className="mb-40 py-20 px-8 border-y border-zinc-900 bg-gradient-to-r from-black via-zinc-950 to-black relative">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1 h-20 bg-gradient-to-b from-blue-500 to-transparent"></div>
          <p className="max-w-4xl mx-auto text-2xl md:text-3xl font-bold text-white text-center leading-snug tracking-tight">“ {t.belief.text} ”</p>
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-20 bg-gradient-to-t from-red-500 to-transparent"></div>
        </motion.div>

        {/* Pillars */}
        <Section title={t.s1.title} icon={Zap}>
          <div>
            <h3 className="text-white text-lg mb-6">{t.s1.h3}</h3>
            <p className="leading-relaxed mb-4">{t.s1.p1}</p>
            <p className="leading-relaxed mb-4">{t.s1.p2}</p>
            <p className="leading-relaxed mb-6">{t.s1.p3}</p>
          </div>
          <div className="bg-zinc-900/50 border border-zinc-800 p-6 rounded-lg font-mono text-xs leading-6 overflow-x-auto text-zinc-300">
            <div className="text-zinc-500 mb-4">// {t.s1.api}</div>
            <div className="mb-4"><span className="text-blue-400">function</span> <span className="text-yellow-400">create</span>(role: <span className="text-green-400">string</span>): <span className="text-blue-400">Promise</span>&lt;<span className="text-green-400">agent_id</span>&gt;;</div>
            <div className="mb-6"><span className="text-blue-400">function</span> <span className="text-yellow-400">send</span>(to: <span className="text-green-400">agent_id</span>, msg: <span className="text-green-400">string</span>): <span className="text-blue-400">Promise</span>&lt;<span className="text-green-400">void</span>&gt;;</div>
            <div className="text-zinc-500 mb-2">// {t.s1.usage}</div>
            <div className="text-blue-400">const</div> <span className="text-white">coder_id</span> = <span className="text-blue-400">await</span> <span className="text-yellow-400">create</span>(<span className="text-green-400">&quot;coder&quot;</span>);<br/>
            <span className="text-blue-400">await</span> <span className="text-yellow-400">send</span>(coder_id, <span className="text-green-400">&quot;Implement the core loop&quot;</span>);
          </div>
        </Section>

        <Section title={t.s2.title} icon={Share2}>
          <div><h3 className="text-white text-lg mb-4">{t.s2.h3}</h3><p className="leading-relaxed">{t.s2.p}</p></div>
          <div className="flex flex-col gap-4">
            <div className="border border-zinc-800 p-4 rounded bg-zinc-950">
              <div className="text-[10px] uppercase text-zinc-600 mb-2 italic">{t.s2.old}</div>
              <div className="flex gap-2 items-center text-zinc-500"><div className="w-12 h-1 border border-zinc-800"></div><div className="w-12 h-1 border border-zinc-800"></div><div className="w-12 h-1 border border-zinc-800"></div><span className="text-[10px] uppercase">{t.s2.old_desc}</span></div>
            </div>
            <div className="border border-blue-900/30 p-4 rounded bg-blue-950/10 shadow-[inset_0_0_20px_rgba(59,130,246,0.05)] text-blue-200">
              <div className="text-[10px] uppercase text-blue-500 mb-2 italic">{t.s2.new}</div>
              <div className="flex gap-2 items-center flex-wrap"><div className="w-3 h-3 rounded-full bg-blue-500"></div><ArrowRight size={10} className="text-blue-500" /><div className="w-3 h-3 rounded-full border border-blue-500"></div><ArrowRight size={10} className="text-blue-500" /><div className="w-3 h-3 rounded-full bg-blue-500 animate-pulse"></div><span className="text-[10px] uppercase">{t.s2.new_desc}</span></div>
            </div>
          </div>
        </Section>

        <Section title={t.s3.title} icon={MessageSquare} stacked={true}>
          <div className="max-w-3xl"><h3 className="text-white text-lg mb-4">{t.s3.h3}</h3><p className="leading-relaxed text-zinc-500">{t.s3.p}</p></div>
          <div className="relative border border-zinc-800 rounded-3xl bg-zinc-950 h-[500px] overflow-hidden shadow-2xl flex items-center justify-center">
             <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff03_1px,transparent_1px),linear-gradient(to_bottom,#ffffff03_1px,transparent_1px)] bg-[size:40px_40px]"></div>
             <div className="relative w-full h-full scale-[0.6] md:scale-[0.85] origin-center">
                <svg className="absolute inset-0 w-full h-full"><g stroke="#27272a" strokeWidth="2"><line x1="500" y1="80" x2="350" y2="200" /><line x1="500" y1="80" x2="650" y2="200" /><line x1="350" y1="200" x2="250" y2="350" /><line x1="350" y1="200" x2="450" y2="350" /><line x1="650" y1="200" x2="550" y2="350" /><line x1="650" y1="200" x2="750" y2="350" /></g></svg>
                <div className="absolute top-[55px] left-[475px]"><div className="w-12 h-12 rounded-full bg-zinc-900 border border-zinc-700 flex items-center justify-center shadow-2xl"><Briefcase size={20} className="text-zinc-500" /></div></div>
                <div className="absolute top-[175px] left-[325px]"><div className="w-12 h-12 rounded-full bg-zinc-900 border border-zinc-700 flex items-center justify-center"><NetworkIcon size={20} className="text-zinc-500" /></div></div>
                <div className="absolute top-[175px] left-[625px]"><div className="w-12 h-12 rounded-full bg-zinc-900 border border-zinc-700 flex items-center justify-center"><NetworkIcon size={20} className="text-zinc-500" /></div></div>
                <div className="absolute top-[320px] left-[520px] z-10"><div className="w-16 h-16 rounded-full bg-black border-2 border-blue-500 shadow-[0_0_50px_rgba(59,130,246,0.4)] flex items-center justify-center relative font-bold"><Code2 size={32} className="text-blue-400" /><div className="absolute inset-0 rounded-full border border-blue-500/20 scale-150 animate-ping"></div></div></div>
                <motion.div initial={{ x: 20, y: 150 }} className="absolute z-50 w-80 h-64 bg-zinc-950/95 backdrop-blur-2xl border border-zinc-800 rounded-2xl shadow-[0_60px_120px_rgba(0,0,0,0.9)] flex flex-col overflow-hidden">
                   <div className="h-10 bg-zinc-900 border-b border-zinc-800 flex items-center px-4 justify-between font-bold text-[9px] text-zinc-500 tracking-[0.3em] uppercase">{t.s3.terminal}</div>
                   <div className="flex flex-1 text-zinc-200"><div className="w-16 border-r border-zinc-900 bg-black flex flex-col items-center py-6 gap-6"><div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/20"><User size={20} /></div><div className="w-10 h-10 rounded-full bg-zinc-900 border border-zinc-800"></div></div>
                      <div className="flex-1 flex flex-col p-6 gap-4"><div className="flex gap-2 items-center"><div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div><div className="h-2 w-32 bg-zinc-800 rounded-full"></div></div><div className="self-end bg-blue-600 text-white text-xs p-4 rounded-3xl rounded-tr-none font-bold shadow-2xl leading-relaxed">{t.s3.chat}</div><div className="mt-auto h-8 bg-zinc-900 rounded-full border border-zinc-800 flex items-center px-4"><div className="w-full h-1 bg-zinc-800 rounded-full"></div></div></div>
                   </div>
                </motion.div>
                <svg className="absolute inset-0 z-30 w-full h-full pointer-events-none"><defs><linearGradient id="laserGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#3b82f6" stopOpacity="0" /><stop offset="50%" stopColor="#3b82f6" stopOpacity="1" /><stop offset="100%" stopColor="#3b82f6" stopOpacity="0" /></linearGradient></defs><motion.path d="M 330 280 C 450 280, 500 350, 530 380" fill="transparent" stroke="url(#laserGrad)" strokeWidth="6" strokeDasharray="15 10" animate={{ strokeDashoffset: [0, -50] }} transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }} className="drop-shadow-[0_0_15px_rgba(59,130,246,0.5)]" /></svg>
             </div>
          </div>
        </Section>

        {/* Call to Action */}
        <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} className="mt-40 text-center py-20 border-t border-zinc-900">
          <div className="text-white font-bold mb-4 tracking-widest uppercase text-xl">{t.cta.ready}</div>
          <p className="max-w-2xl mx-auto text-sm text-zinc-500 mb-10 leading-relaxed">{t.cta.desc}</p>
          <Link href="/demo" className="text-blue-500 hover:text-blue-400 transition-colors flex items-center justify-center gap-2 text-lg font-bold">
            {t.cta.btn} <ArrowRight size={22} />
          </Link>
        </motion.div>
      </main>

      <footer className="px-8 py-20 border-t border-zinc-900 bg-zinc-950/20 backdrop-blur-sm">
         <div className="max-w-5xl mx-auto flex flex-col md:flex-row justify-between gap-12">
            <div className="flex flex-col gap-4">
              <div className="font-bold text-white tracking-tighter flex items-center gap-2 text-lg"><Cpu size={22} /> AGENT WECHAT</div>
              <p className="text-[10px] text-zinc-600 uppercase tracking-widest leading-loose text-zinc-500">© 2026 AGENT WECHAT PROJECT<br/>Decentralized Organization Intelligence</p>
            </div>
            <div className="flex flex-col gap-6">
               <div className="text-xs font-bold text-white uppercase tracking-widest">{t.footer.contact}</div>
               <div className="flex gap-6 items-center">
                  <a href="https://discord.gg/NQBg63b8A5" target="_blank" className="p-3 bg-zinc-900 border border-zinc-800 rounded-full hover:bg-[#5865F2] hover:border-[#5865F2] hover:text-white transition-all shadow-xl group relative text-zinc-400"><Discord size={20} /></a>
                  <div onMouseEnter={() => setShowWeChat(true)} onMouseLeave={() => setShowWeChat(false)} className="p-3 bg-zinc-900 border border-zinc-800 rounded-full hover:bg-[#07C160] hover:border-[#07C160] hover:text-white transition-all shadow-xl cursor-pointer relative group text-zinc-400"><MessageCircle size={20} /><AnimatePresence>{showWeChat && (<motion.div initial={{ opacity: 0, y: 10, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.9 }} className="absolute bottom-16 left-1/2 -translate-x-1/2 p-4 bg-white rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] z-50 border border-zinc-200"><img src="/wechat-qr.png" alt="WeChat QR" className="w-32 h-32 rounded-lg" /><div className="text-black text-[10px] font-bold mt-2 text-center uppercase tracking-tighter whitespace-nowrap">{t.footer.wechat_tip}</div><div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-4 bg-white rotate-45 border-r border-b border-zinc-200"></div></motion.div>)}</AnimatePresence></div>
                  <a href="https://github.com/chmod777john/agent-wechat" target="_blank" className="p-3 bg-zinc-900 border border-zinc-800 rounded-full hover:bg-white hover:border-white hover:text-black transition-all shadow-xl group relative text-zinc-400"><Cpu size={20} /></a>
               </div>
            </div>
            <div className="flex flex-col gap-4 text-xs">
               <div className="text-zinc-600 font-bold uppercase tracking-widest">Discussion</div>
               <div className="flex flex-col gap-2">
                  <a href="https://mp.weixin.qq.com/s/NyTKgrIynElcpDe7v2naDQ" target="_blank" className="hover:text-white transition-colors">{t.footer.wechat_article}</a>
                  <a href="https://zhuanlan.zhihu.com/p/1990912369149366445" target="_blank" className="hover:text-white transition-colors">{t.footer.zhihu_article}</a>
                  <a href="https://x.com/chmod777john/status/2007634694150434875" target="_blank" className="hover:text-white transition-colors">{t.footer.x_post}</a>
               </div>
            </div>
         </div>
         <div className="max-w-5xl mx-auto mt-20 p-6 border border-zinc-900 bg-black rounded-2xl flex flex-col md:flex-row items-center gap-6 group hover:border-blue-900/50 transition-all text-zinc-400"><div className="p-4 bg-zinc-900/50 rounded-xl text-blue-500 group-hover:scale-110 transition-transform border border-zinc-800"><Shield size={32} /></div><div className="flex-1 text-center md:text-left"><div className="text-white font-bold text-sm uppercase tracking-widest mb-1">{t.footer.proof}</div><p className="text-[10px] text-zinc-500 max-w-xl leading-relaxed">{t.footer.proof_desc}</p></div><a href="https://viewblock.io/arweave/tx/BJ5GVAQBUXtv21jIEvuyqTsv9t93j7rlG47Lwcmtdu8" target="_blank" className="px-6 py-2 bg-zinc-900 border border-zinc-800 rounded-full text-[10px] font-mono text-zinc-300 hover:bg-white hover:text-black transition-all shadow-lg">TX: BJ5GVAQ...du8</a></div>
      </footer>
    </div>
  );
}