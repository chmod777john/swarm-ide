"use client";

import React, { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { MessageSquare, Cpu, Share2, ArrowRight, Zap, Mail, Layers, Code2, User, Briefcase, Network as NetworkIcon, Globe } from "lucide-react";

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

// --- Translation Dictionary ---

const CONTENT: any = {
  zh: {
    nav: { demo: "启动演示", whitepaper: "白皮书", github: "代码仓" },
    hero: {
      title: "MINIMAL PRIMITIVES.",
      subtitle: "如果人类社会可以通过“微信”这种简单的 IM 界面组织起数十亿人的协作，那么 AI Agents 也不应该被锁死在复杂的图结构（DAG）中。",
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
      ready: "准备好进入 Agent 社交时代吗？",
      btn: "探索交互式演示"
    }
  },
  en: {
    nav: { demo: "Launch Demo", whitepaper: "Whitepaper", github: "GitHub" },
    hero: {
      title: "MINIMAL PRIMITIVES.",
      subtitle: "If human society can organize billions of people through simple IM interfaces like WeChat, AI Agents should not be locked in complex graph structures (DAGs).",
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
      ready: "Ready for the era of Agent Social?",
      btn: "Explore Interactive Demo"
    }
  }
};

// --- Main Page ---

export default function WhitepaperHome() {
  const [lang, setLang] = useState<"zh" | "en">("zh");
  const t = CONTENT[lang];

  return (
    <div className="min-h-screen bg-black text-zinc-400 font-mono selection:bg-white selection:text-black">
      
      {/* Navigation */}
      <nav className="fixed top-0 w-full z-50 px-8 h-16 flex items-center justify-between backdrop-blur-md border-b border-white/5 bg-black/50">
        <div className="font-bold text-white tracking-tighter flex items-center gap-2">
          <Cpu size={18} /> AGENT WECHAT
        </div>
        <div className="flex items-center gap-8 text-xs uppercase tracking-widest">
          <div className="hidden md:flex gap-8">
            <Link href="/demo" className="text-zinc-500 hover:text-white transition-colors">{t.nav.demo}</Link>
            <a href="#" className="text-zinc-500 hover:text-white transition-colors">{t.nav.whitepaper}</a>
            <a href="#" className="text-zinc-500 hover:text-white transition-colors">{t.nav.github}</a>
          </div>
          <button 
            onClick={() => setLang(lang === "zh" ? "en" : "zh")}
            className="flex items-center gap-2 px-3 py-1 bg-zinc-900 border border-zinc-800 rounded text-zinc-200 hover:bg-zinc-800 transition-all font-bold"
          >
            <Globe size={14} /> {lang.toUpperCase()}
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="max-w-5xl mx-auto px-8 pt-40 pb-20">
        <motion.div 
          key={lang}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          className="mb-32"
        >
          <h1 className="text-5xl md:text-7xl font-bold text-white mb-6 tracking-tighter leading-none">
            {t.hero.title}<br/>
            <span className="text-red-500">NO MORE LANGGRAPH.</span>
          </h1>
          <p className="max-w-2xl text-lg leading-relaxed mb-10 text-zinc-500">
            {t.hero.subtitle}
          </p>
          <div className="flex gap-4">
            <Link href="/demo" className="px-8 py-3 bg-white text-black font-bold hover:bg-zinc-200 transition-all flex items-center gap-2">
              RUN SIMULATION <ArrowRight size={18} />
            </Link>
          </div>
        </motion.div>

        {/* Pillar 1: Primitives */}
        <Section title={t.s1.title} icon={Zap}>
          <div>
            <h3 className="text-white text-lg mb-6">{t.s1.h3}</h3>
            <p className="leading-relaxed mb-4">{t.s1.p1}</p>
            <p className="leading-relaxed mb-4">{t.s1.p2}</p>
            <p className="leading-relaxed mb-6">{t.s1.p3}</p>
          </div>
          <div className="bg-zinc-900/50 border border-zinc-800 p-6 rounded-lg font-mono text-xs leading-6 overflow-x-auto">
            <div className="text-zinc-500 mb-4">// {t.s1.api}</div>
            <div className="mb-4">
              <span className="text-blue-400">function</span> <span className="text-yellow-400">create</span>(role: <span className="text-green-400">string</span>): <span className="text-blue-400">Promise</span>&lt;<span className="text-green-400">agent_id</span>&gt;;
            </div>
            <div className="mb-6">
              <span className="text-blue-400">function</span> <span className="text-yellow-400">send</span>(to: <span className="text-green-400">agent_id</span>, msg: <span className="text-green-400">string</span>): <span className="text-blue-400">Promise</span>&lt;<span className="text-green-400">void</span>&gt;;
            </div>
            <div className="text-zinc-500 mb-2">// {t.s1.usage}</div>
            <div className="text-blue-400">const</div> <span className="text-white">coder_id</span> = <span className="text-blue-400">await</span> <span className="text-yellow-400">create</span>(<span className="text-green-400">&quot;coder&quot;</span>);<br/>
            <span className="text-blue-400">await</span> <span className="text-yellow-400">send</span>(coder_id, <span className="text-green-400">&quot;Implement the core loop&quot;</span>);
          </div>
        </Section>

        {/* Pillar 2: Autonomy */}
        <Section title={t.s2.title} icon={Share2}>
          <div>
            <h3 className="text-white text-lg mb-4">{t.s2.h3}</h3>
            <p className="leading-relaxed">{t.s2.p}</p>
          </div>
          <div className="flex flex-col gap-4">
            <div className="border border-zinc-800 p-4 rounded bg-zinc-950">
              <div className="text-[10px] uppercase text-zinc-600 mb-2 italic">{t.s2.old}</div>
              <div className="flex gap-2 items-center text-zinc-500">
                 <div className="w-12 h-1 border border-zinc-800"></div>
                 <div className="w-12 h-1 border border-zinc-800"></div>
                 <div className="w-12 h-1 border border-zinc-800"></div>
                 <span className="text-[10px] uppercase">{t.s2.old_desc}</span>
              </div>
            </div>
            <div className="border border-blue-900/30 p-4 rounded bg-blue-950/10 shadow-[inset_0_0_20px_rgba(59,130,246,0.05)] text-blue-200">
              <div className="text-[10px] uppercase text-blue-500 mb-2 italic">{t.s2.new}</div>
              <div className="flex gap-2 items-center flex-wrap">
                 <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                 <ArrowRight size={10} className="text-blue-500" />
                 <div className="w-3 h-3 rounded-full border border-blue-500"></div>
                 <ArrowRight size={10} className="text-blue-500" />
                 <div className="w-3 h-3 rounded-full bg-blue-500 animate-pulse"></div>
                 <span className="text-[10px] uppercase">{t.s2.new_desc}</span>
              </div>
            </div>
          </div>
        </Section>

        {/* Pillar 3: Panoramic Illustration */}
        <Section title={t.s3.title} icon={MessageSquare} stacked={true}>
          <div className="max-w-3xl">
            <h3 className="text-white text-lg mb-4">{t.s3.h3}</h3>
            <p className="leading-relaxed text-zinc-500">{t.s3.p}</p>
          </div>
          
          <div className="relative border border-zinc-800 rounded-3xl bg-zinc-950 h-[500px] overflow-hidden shadow-2xl flex items-center justify-center">
             <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff03_1px,transparent_1px),linear-gradient(to_bottom,#ffffff03_1px,transparent_1px)] bg-[size:40px_40px]"></div>
             
             <div className="relative w-full h-full scale-[0.6] md:scale-[0.85] origin-center">
                
                {/* Precise Tree Connections */}
                <svg className="absolute inset-0 w-full h-full">
                   <g stroke="#27272a" strokeWidth="2">
                      <line x1="500" y1="80" x2="350" y2="200" />
                      <line x1="500" y1="80" x2="650" y2="200" />
                      <line x1="350" y1="200" x2="250" y2="350" />
                      <line x1="350" y1="200" x2="450" y2="350" />
                      <line x1="650" y1="200" x2="550" y2="350" />
                      <line x1="650" y1="200" x2="750" y2="350" />
                   </g>
                </svg>

                {/* Nodes */}
                <div className="absolute top-[55px] left-[475px]">
                   <div className="w-12 h-12 rounded-full bg-zinc-900 border border-zinc-700 flex items-center justify-center shadow-2xl"><Briefcase size={20} className="text-zinc-500" /></div>
                </div>
                <div className="absolute top-[175px] left-[325px]">
                   <div className="w-12 h-12 rounded-full bg-zinc-900 border border-zinc-700 flex items-center justify-center"><NetworkIcon size={20} className="text-zinc-500" /></div>
                </div>
                <div className="absolute top-[175px] left-[625px]">
                   <div className="w-12 h-12 rounded-full bg-zinc-900 border border-zinc-700 flex items-center justify-center"><NetworkIcon size={20} className="text-zinc-500" /></div>
                </div>
                <div className="absolute top-[325px] left-[225px] opacity-40">
                   <div className="w-12 h-12 rounded-full bg-zinc-900 border border-zinc-700 flex items-center justify-center"><Code2 size={20} className="text-zinc-600"/></div>
                </div>
                <div className="absolute top-[325px] left-[425px] opacity-40">
                   <div className="w-12 h-12 rounded-full bg-zinc-900 border border-zinc-700 flex items-center justify-center"><Layers size={20} className="text-zinc-600"/></div>
                </div>
                <div className="absolute top-[325px] left-[725px] opacity-40">
                   <div className="w-12 h-12 rounded-full bg-zinc-900 border border-zinc-700 flex items-center justify-center"><Code2 size={20} className="text-zinc-600"/></div>
                </div>

                <div className="absolute top-[320px] left-[520px] z-10">
                   <div className="w-16 h-16 rounded-full bg-black border-2 border-blue-500 shadow-[0_0_50px_rgba(59,130,246,0.4)] flex items-center justify-center relative">
                      <Code2 size={32} className="text-blue-400" />
                      <div className="absolute inset-0 rounded-full border border-blue-500/20 scale-150 animate-ping"></div>
                   </div>
                   <div className="mt-3 text-center">
                      <span className="px-2 py-0.5 bg-blue-500 text-white text-[8px] font-bold rounded uppercase tracking-widest">{t.s3.target}</span>
                   </div>
                </div>

                {/* IM Console */}
                <motion.div 
                  initial={{ x: 20, y: 150 }}
                  className="absolute z-50 w-80 h-64 bg-zinc-950/95 backdrop-blur-2xl border border-zinc-800 rounded-2xl shadow-[0_60px_120px_rgba(0,0,0,0.9)] flex flex-col overflow-hidden"
                >
                   <div className="h-10 bg-zinc-900 border-b border-zinc-800 flex items-center px-4 justify-between font-bold">
                      <div className="flex gap-2">
                         <div className="w-3 h-3 rounded-full bg-red-900/40"></div>
                         <div className="w-3 h-3 rounded-full bg-yellow-900/40"></div>
                         <div className="w-3 h-3 rounded-full bg-green-900/40"></div>
                      </div>
                      <div className="text-[9px] text-zinc-500 tracking-[0.3em] uppercase">{t.s3.terminal}</div>
                   </div>
                   <div className="flex flex-1">
                      <div className="w-16 border-r border-zinc-900 bg-black flex flex-col items-center py-6 gap-6 text-zinc-600">
                         <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white"><User size={20} /></div>
                         <div className="w-10 h-10 rounded-full bg-zinc-900 border border-zinc-800"></div>
                      </div>
                      <div className="flex-1 flex flex-col p-6 gap-4">
                         <div className="flex gap-2 items-center">
                            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                            <div className="h-2 w-32 bg-zinc-800 rounded-full"></div>
                         </div>
                         <div className="self-end bg-blue-600 text-white text-xs p-4 rounded-3xl rounded-tr-none font-bold shadow-2xl leading-relaxed">
                            {t.s3.chat}
                         </div>
                         <div className="mt-auto h-8 bg-zinc-900 rounded-full border border-zinc-800 flex items-center px-4"><div className="w-full h-1 bg-zinc-800 rounded-full"></div></div>
                      </div>
                   </div>
                </motion.div>

                {/* Laser */}
                <svg className="absolute inset-0 z-30 w-full h-full pointer-events-none">
                   <defs>
                      <linearGradient id="laserGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                         <stop offset="0%" stopColor="#3b82f6" stopOpacity="0" />
                         <stop offset="50%" stopColor="#3b82f6" stopOpacity="1" />
                         <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
                      </linearGradient>
                   </defs>
                   <motion.path d="M 330 280 C 450 280, 500 350, 530 380" fill="transparent" stroke="url(#laserGrad)" strokeWidth="6" strokeDasharray="15 10" animate={{ strokeDashoffset: [0, -50] }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} />
                </svg>
             </div>
          </div>
        </Section>

        {/* Call to Action */}
        <motion.div 
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          className="mt-40 text-center py-20 border-t border-zinc-900"
        >
          <div className="text-white font-bold mb-6 tracking-widest uppercase text-xl">{t.cta.ready}</div>
          <Link href="/demo" className="text-blue-500 hover:text-blue-400 transition-colors flex items-center justify-center gap-2 text-lg font-bold">
            {t.cta.btn} <ArrowRight size={22} />
          </Link>
        </motion.div>
      </main>

      <footer className="px-8 py-12 border-t border-zinc-900 text-[10px] text-zinc-700 flex justify-between uppercase tracking-widest">
         <div>© 2026 AGENT WECHAT PROJECT</div>
         <div className="flex gap-8">
            <a href="#">Security</a>
            <a href="#">Architecture</a>
            <a href="#">Manifesto</a>
         </div>
      </footer>
    </div>
  );
}
