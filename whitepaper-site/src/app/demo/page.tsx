"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence, useMotionValue, useTransform } from "framer-motion";
import { User, Code2, Briefcase, Network, MessageSquare, Play, Pause, RotateCcw, Zap, Terminal, Search, Plus, ListFilter, Clock, Maximize2 } from "lucide-react";

// --- Types ---

type AgentRole = "Human" | "Manager" | "Architect" | "Coder";
type AgentStatus = "IDLE" | "BUSY" | "WAKING";

interface Agent {
  id: string;
  role: AgentRole;
  label: string;
  status: AgentStatus;
  inbox: number; 
  x: number;
  y: number;
}

interface Message {
  id: number;
  fromId: string;
  toId: string;
  content: string;
  timestamp: string;
  status: "SENT" | "BUFFERED" | "PROCESSED";
}

interface Beam {
  id: number;
  fromPos: { x: number, y: number };
  toPos: { x: number, y: number };
  type: 'MSG' | 'CREATE';
  color: string;
  content?: string;
}

interface SystemEvent {
  id: string;
  type: 'CREATE' | 'MESSAGE' | 'STATUS' | 'WAKE';
  title: string;
  desc: string;
  timestamp: string;
  color: string;
}

// --- Visual Components ---

const AgentNode = ({ agent, onClick, isSelected }: { agent: Agent, onClick: (e: any) => void, isSelected: boolean }) => {
  const isHuman = agent.role === "Human";
  const Icon = isHuman ? User : agent.role === "Manager" ? Briefcase : agent.role === "Architect" ? Network : Code2;
  
  let ringColor = "border-zinc-700";
  let glow = "";
  
  if (agent.status === "BUSY") {
    ringColor = "border-red-500";
    glow = "shadow-[0_0_30px_rgba(239,68,68,0.4)]";
  } else if (agent.status === "WAKING") {
    ringColor = "border-yellow-400";
    glow = "shadow-[0_0_30px_rgba(250,204,21,0.6)]";
  } else {
    ringColor = isHuman ? "border-white" : "border-green-500";
    glow = isHuman ? "shadow-[0_0_20px_rgba(255,255,255,0.2)]" : "shadow-[0_0_15px_rgba(74,222,128,0.1)]";
  }

  return (
    <motion.div
      layoutId={agent.id}
      initial={{ scale: 0, opacity: 0, x: agent.x, y: agent.y }}
      animate={{ scale: 1, opacity: 1, x: agent.x, y: agent.y }}
      transition={{ type: "spring", stiffness: 260, damping: 20 }}
      className="absolute -ml-10 -mt-10 cursor-pointer group z-20"
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
    >
      {isSelected && (
        <motion.div 
          layoutId="selection"
          className="absolute -inset-4 border border-zinc-500 rounded-full opacity-50"
          transition={{ duration: 0.2 }}
        />
      )}

      <div className={`w-20 h-20 rounded-full bg-black border-2 ${ringColor} ${glow} flex items-center justify-center relative transition-all duration-300`}>
        <Icon size={24} className={isHuman ? "text-white" : "text-zinc-200"} />
        {agent.status === "BUSY" && (
           <motion.div 
             className="absolute inset-0 border-2 border-t-transparent border-r-transparent border-red-500 rounded-full"
             animate={{ rotate: 360 }}
             transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
           />
        )}
      </div>

      <div className="absolute top-24 left-1/2 -translate-x-1/2 text-center w-32 pointer-events-none">
        <div className="text-xs font-bold text-zinc-300 shadow-black drop-shadow-md">{agent.label}</div>
        <div className={`text-[9px] font-mono ${agent.status === "BUSY" ? "text-red-400" : agent.status === "WAKING" ? "text-yellow-400" : "text-zinc-500"}`}>
          {agent.status}
        </div>
      </div>

      <AnimatePresence>
        {agent.inbox > 0 && Array.from({ length: agent.inbox }).map((_, i) => (
          <motion.div
            key={`inbox-${i}`}
            initial={{ scale: 0 }}
            animate={{ 
              scale: 1,
              rotate: 360,
              x: Math.cos(i * 1.5) * 35, 
              y: Math.sin(i * 1.5) * 35 
            }}
            exit={{ scale: 0, x: 0, y: 0 }} 
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            className="absolute top-1/2 left-1/2 w-3 h-3 bg-white rounded-full shadow-[0_0_10px_white] z-30 pointer-events-none"
          />
        ))}
      </AnimatePresence>
    </motion.div>
  );
};

const LaserBeam = ({ beam }: { beam: Beam }) => {
  const isCreate = beam.type === 'CREATE';
  const midX = (beam.fromPos.x + beam.toPos.x) / 2;
  const midY = (beam.fromPos.y + beam.toPos.y) / 2;
  
  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.8 }}
      className="absolute inset-0 pointer-events-none overflow-visible z-10 w-full h-full"
    >
      <svg className="absolute inset-0 w-full h-full overflow-visible">
        <motion.line
          x1={beam.fromPos.x} y1={beam.fromPos.y} x2={beam.toPos.x} y2={beam.toPos.y}
          stroke={beam.color}
          strokeWidth={isCreate ? "2" : "1"}
          strokeDasharray={isCreate ? "6 4" : "none"}
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: isCreate ? 0.5 : 0.25 }}
          transition={{ duration: 0.4 }}
        />
        <motion.circle
          r={isCreate ? "7" : "4"}
          fill={beam.color}
          initial={{ cx: beam.fromPos.x, cy: beam.fromPos.y }}
          animate={{ cx: beam.toPos.x, cy: beam.toPos.y }}
          transition={{ duration: 0.8, ease: "easeInOut" }}
          style={{ 
            filter: `drop-shadow(0 0 ${isCreate ? '12px' : '5px'} ${beam.color})`
          }}
        />
      </svg>

      <motion.div
        initial={{ y: midY - 10, opacity: 0, scale: 0.9 }}
        animate={{ y: midY - 30, opacity: 1, scale: 1 }}
        className={`absolute whitespace-nowrap text-xs font-mono font-bold px-3 py-1 rounded border backdrop-blur-md z-50 ${
          isCreate 
            ? "bg-blue-950/80 border-blue-400/50 text-blue-100 shadow-[0_0_20px_rgba(59,130,246,0.4)]" 
            : "bg-zinc-900/80 border-zinc-600/50 text-zinc-100 shadow-xl"
        }`}
        style={{
          left: midX,
          top: 0,
          transform: 'translateX(-50%)'
        }}
      >
        {isCreate ? (
          <span>create_agent(&quot;<span className="text-blue-300">{beam.content}</span>&quot;)</span>
        ) : (
          <span>send_message(&quot;<span className="text-zinc-300">{beam.content}</span>&quot;)</span>
        )}
      </motion.div>
    </motion.div>
  );
};

// --- Main Page ---

export default function DemoPage() {
  const [agents, setAgents] = useState<Agent[]>([
    { id: "human", role: "Human", label: "Human", status: "IDLE", inbox: 0, x: 200, y: 450 }
  ]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeBeams, setActiveBeams] = useState<Beam[]>([]);
  const [events, setEvents] = useState<SystemEvent[]>([]);
  
  // Transform State
  const [scale, setScale] = useState(0.9);
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [activeContactId, setActiveContactId] = useState<string>("mgr");
  const [myIdentityId, setMyIdentityId] = useState<string>("human");

  const agentsRef = useRef(agents);
  useEffect(() => { agentsRef.current = agents; }, [agents]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const eventsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activeContactId]);

  useEffect(() => {
    eventsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  // Handle Wheel manually to prevent browser zoom
  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.05 : 0.05;
        setScale(s => Math.min(Math.max(s + delta, 0.4), 2));
      }
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, []);

  const addEvent = (type: SystemEvent['type'], title: string, desc: string, color: string) => {
    setEvents(prev => [...prev, {
      id: Math.random().toString(36).substr(2, 9),
      type, title, desc, color,
      timestamp: new Date().toLocaleTimeString('en-US', { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
    }]);
  };

  // --- Director Script ---
  useEffect(() => {
    if (!isPlaying) return;
    let timeouts: NodeJS.Timeout[] = [];
    const schedule = (fn: () => void, ms: number) => timeouts.push(setTimeout(fn, ms));

    const spawnAgent = (fromId: string, newId: string, role: AgentRole, label: string, x: number, y: number) => {
       const fromAgent = agentsRef.current.find(a => a.id === fromId) || { x: 0, y: 0 };
       const beamId = Date.now() + Math.random();
       
       addEvent('CREATE', `create_agent`, `${label} initialized by ${fromId}`, 'text-blue-400');

       setActiveBeams(prev => [...prev, { 
         id: beamId, 
         fromPos: { x: fromAgent.x, y: fromAgent.y }, 
         toPos: { x, y }, 
         type: 'CREATE',
         color: "#3b82f6",
         content: role.toUpperCase()
       }]);

       schedule(() => {
         setAgents(prev => [...prev, { id: newId, role, label, status: "IDLE", inbox: 0, x, y }]);
         addMessage("system", fromId, `System: ${label} hired.`);
         setTimeout(() => {
            setActiveBeams(prev => prev.filter(b => b.id !== beamId));
         }, 2000);
       }, 800);
    };

    const sendMsg = (fromId: string, toId: string, content: string, shouldBuffer: boolean) => {
       const fromA = agentsRef.current.find(a => a.id === fromId);
       const toA = agentsRef.current.find(a => a.id === toId);
       if (!fromA || !toA) return;

       const beamId = Date.now() + Math.random();
       const displayContent = content.length > 30 ? content.substring(0, 27) + "..." : content;

       addEvent('MESSAGE', `send_message`, `${fromId} → ${toId}: ${displayContent}`, 'text-zinc-100');

       setActiveBeams(prev => [...prev, { 
         id: beamId, 
         fromPos: { x: fromA.x, y: fromA.y }, 
         toPos: { x: toA.x, y: toA.y }, 
         type: 'MSG',
         color: "#fff",
         content: displayContent
       }]);

       schedule(() => {
         if (shouldBuffer) {
           updateAgent(toId, a => ({ inbox: a.inbox + 1 }));
           addMessage(fromId, toId, content, "BUFFERED");
           addEvent('STATUS', `message_buffered`, `Task added to ${toId}'s Inbox`, 'text-yellow-500');
         } else {
           addMessage(fromId, toId, content, "SENT");
         }
         setTimeout(() => {
           setActiveBeams(prev => prev.filter(b => b.id !== beamId));
         }, 200);
       }, 800);
    };

    const setStatus = (id: string, status: AgentStatus) => {
        updateAgent(id, a => ({ status }));
        addEvent('STATUS', `status_update`, `${id} is now ${status}`, status === 'BUSY' ? 'text-red-400' : 'text-yellow-400');
    };

    // Script
    schedule(() => addMessage("system", "human", "System: Simulation Initialized."), 100);
    schedule(() => addMessage("human", "mgr", "Build a Snake Game."), 1000);
    schedule(() => spawnAgent("human", "mgr", "Manager", "Manager", 450, 450), 1500);
    schedule(() => addMessage("mgr", "human", "Received. Hiring team..."), 2500);
    schedule(() => setStatus("mgr", "BUSY"), 3000);
    schedule(() => {
      spawnAgent("mgr", "arch", "Architect", "Architect", 700, 250);
      setStatus("mgr", "IDLE");
    }, 4500);
    schedule(() => setStatus("arch", "BUSY"), 5500);
    schedule(() => {
      spawnAgent("arch", "coder", "Coder", "Coder", 950, 500);
      setStatus("arch", "IDLE");
    }, 7000);
    schedule(() => sendMsg("arch", "coder", "Task: Implement Core Loop", false), 8000);
    schedule(() => setStatus("coder", "BUSY"), 9000);
    schedule(() => sendMsg("human", "coder", "Wait! Make it 3D!", true), 11000);
    schedule(() => setStatus("coder", "WAKING"), 14000);
    schedule(() => {
      addEvent('WAKE', `agent_wakeup`, `Coder processing Buffered Inbox`, 'text-green-400');
      updateAgent("coder", a => ({ status: "BUSY", inbox: 0 })); 
      setMessages(prev => prev.map(m => m.toId === "coder" && m.status === "BUFFERED" ? { ...m, status: "PROCESSED" } : m));
      addMessage("coder", "human", "Got it. 3D mode enabled.", "SENT");
    }, 15500);

    return () => timeouts.forEach(clearTimeout);
  }, [isPlaying]);

  // Helpers
  const updateAgent = (id: string, fn: (a: Agent) => Partial<Agent>) => {
    setAgents(prev => prev.map(a => a.id === id ? { ...a, ...fn(a) } : a));
  };

  const addMessage = (fromId: string, toId: string, content: string, status: Message['status'] = "SENT") => {
    setMessages(prev => [...prev, {
      id: Date.now() + Math.random(), fromId, toId, content,
      timestamp: new Date().toLocaleTimeString('en-US', {hour12:false, hour:"2-digit", minute:"2-digit"}),
      status
    }]);
  };

  const reset = () => {
    setIsPlaying(false);
    setAgents([{ id: "human", role: "Human", label: "Human", status: "IDLE", inbox: 0, x: 200, y: 450 }]);
    setMessages([]);
    setActiveBeams([]);
    setEvents([]);
    setScale(0.9);
  };

  const contacts = agents.filter(a => a.id !== myIdentityId);
  const chatMessages = messages.filter(m => (m.fromId === myIdentityId && m.toId === activeContactId) || (m.fromId === activeContactId && m.toId === myIdentityId) || (m.fromId === "system" && m.toId === myIdentityId));

  return (
    <div className="flex h-screen bg-black text-zinc-200 font-sans overflow-hidden">
      
      {/* 1. IM Sidebar */}
      <div className="w-60 flex flex-col border-r border-zinc-900 bg-zinc-950 z-30">
        <div className="h-16 flex items-center px-4 border-b border-zinc-900 font-bold text-white bg-black/20">
          <MessageSquare size={18} className="mr-2 text-blue-500" /> Chats
        </div>
        <div className="flex-1 overflow-y-auto">
          {contacts.map(contact => {
             const lastMsg = messages.filter(m => (m.fromId === contact.id && m.toId === myIdentityId) || (m.fromId === myIdentityId && m.toId === contact.id)).pop();
             const isSelected = activeContactId === contact.id;
             return (
               <div key={contact.id} onClick={() => setActiveContactId(contact.id)}
                 className={`p-3 flex items-center gap-3 cursor-pointer hover:bg-zinc-900 transition-colors ${isSelected ? "bg-zinc-900 border-l-2 border-blue-500" : "border-l-2 border-transparent"}`}>
                 <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center border border-zinc-700 relative">
                    {contact.role === "Manager" ? <Briefcase size={16}/> : contact.role === "Architect" ? <Network size={16}/> : <Code2 size={16}/>}
                    <div className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-zinc-900 ${contact.status === "BUSY" ? "bg-red-500" : contact.status === "WAKING" ? "bg-yellow-500" : "bg-green-500"}`}></div>
                 </div>
                 <div className="flex-1 min-w-0">
                   <div className="flex justify-between items-baseline text-sm text-zinc-200 truncate font-medium">{contact.label}</div>
                   <div className="text-xs text-zinc-500 truncate">{lastMsg ? lastMsg.content : "..."}</div>
                 </div>
               </div>
             );
          })}
        </div>
      </div>

      {/* 2. IM Main */}
      <div className="w-80 flex flex-col border-r border-zinc-900 bg-black z-30 shadow-2xl">
        <div className="h-16 flex items-center justify-between px-6 border-b border-zinc-900 bg-zinc-950/50 backdrop-blur"><span className="font-bold text-white">{contacts.find(c => c.id === activeContactId)?.label || "Select Chat"}</span></div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gradient-to-b from-zinc-950 to-black">
           {chatMessages.map(msg => {
             const isMe = msg.fromId === myIdentityId;
             return (
               <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] p-3 rounded-2xl text-sm ${isMe ? "bg-blue-600 text-white rounded-tr-none" : "bg-zinc-800 text-zinc-200 rounded-tl-none border border-zinc-700"} ${msg.status === "BUFFERED" ? "opacity-50 border-dashed" : ""}`}>
                    {msg.content}
                    {msg.status === "BUFFERED" && <div className="text-[9px] mt-1 font-mono uppercase opacity-70 flex items-center gap-1"><Zap size={8}/> Buffered</div>}
                  </div>
               </div>
             )
           })}
           <div ref={messagesEndRef} />
        </div>
        <div className="p-4 border-t border-zinc-900 bg-zinc-950"><div className="bg-zinc-900 rounded-full px-4 py-2 flex items-center gap-2 border border-zinc-800 opacity-50 text-sm">Read-only simulation</div></div>
      </div>

      {/* 3. Infinite Canvas */}
      <div 
        ref={canvasContainerRef}
        className="flex-1 relative bg-zinc-950 overflow-hidden cursor-grab active:cursor-grabbing border-r border-zinc-900 select-none"
      >
         {/* Fixed UI Overlays */}
         <div className="absolute top-6 left-6 z-40 flex flex-col gap-2">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-zinc-900/80 border border-zinc-800 rounded-full text-xs text-zinc-400 backdrop-blur">
               <Terminal size={12} className="text-green-500"/><span>Global Topology</span>
            </div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-zinc-900/80 border border-zinc-800 rounded-full text-[10px] text-zinc-500 backdrop-blur">
               <Maximize2 size={10}/><span>Zoom: {Math.round(scale * 100)}% (Ctrl + Scroll)</span>
            </div>
         </div>

         <div className="absolute bottom-8 right-8 flex gap-4 z-50">
            {!isPlaying ? (
              <button onClick={() => setIsPlaying(true)} className="flex items-center gap-2 px-6 py-3 bg-white text-black rounded-full font-bold hover:bg-zinc-200 shadow-2xl transition-all font-mono"><Play size={18} fill="black" /> RUN</button>
            ) : (
              <button onClick={() => setIsPlaying(false)} className="flex items-center gap-2 px-6 py-3 bg-zinc-900 text-white border border-zinc-700 rounded-full font-bold font-mono"><Pause size={18} fill="white" /> PAUSE</button>
            )}
            <button onClick={reset} className="p-3 bg-zinc-900 border border-zinc-700 rounded-full text-zinc-400 hover:text-white transition-colors"><RotateCcw size={18} /></button>
         </div>

         {/* Draggable & Zoomable Container */}
         <motion.div 
           drag
           dragMomentum={false}
           style={{ scale }}
           className="absolute inset-0 w-full h-full"
         >
            <div className="absolute inset-[-2000px] bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:50px_50px]"></div>
            
            <AnimatePresence>
              {activeBeams.map(beam => <LaserBeam key={beam.id} beam={beam} />)}
            </AnimatePresence>
            
            {agents.map(agent => (
              <AgentNode 
                key={agent.id} 
                agent={agent} 
                isSelected={activeContactId === agent.id} 
                onClick={() => setActiveContactId(agent.id)} 
              />
            ))}
         </motion.div>
      </div>

      {/* 4. Event Log Sidebar */}
      <div className="w-80 flex flex-col bg-zinc-950 z-30">
        <div className="h-16 flex items-center px-4 border-b border-zinc-900 font-bold text-white bg-black/20">
          <ListFilter size={18} className="mr-2 text-green-500" /> Event Log
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4 font-mono">
           <AnimatePresence initial={false}>
             {events.map((ev) => (
               <motion.div key={ev.id} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="flex flex-col gap-1 border-l border-zinc-800 pl-3 py-1">
                 <div className="flex justify-between items-center text-[10px]">
                    <span className={`font-bold ${ev.color}`}>[{ev.type}]</span>
                    <span className="text-zinc-600 flex items-center gap-1"><Clock size={10}/> {ev.timestamp}</span>
                 </div>
                 <div className="text-xs text-zinc-200 truncate select-text">{ev.title}</div>
                 <div className="text-[10px] text-zinc-500 leading-tight select-text">{ev.desc}</div>
               </motion.div>
             ))}
           </AnimatePresence>
           <div ref={eventsEndRef} />
        </div>
      </div>

    </div>
  );
}