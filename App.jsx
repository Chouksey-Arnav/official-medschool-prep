import { useState, useEffect, useRef, useCallback } from "react";
import { QUIZ_BANK, CATEGORIES, DIFFICULTY_COLORS } from "./quizData";

// ─── CONFIG — paste your keys here ───────────────────────────────────────
const OPENAI_API_KEY = "sk-proj-REPLACE_WITH_YOUR_KEY";
const OPENAI_MODEL   = "gpt-4o-mini"; // cheapest capable model ~$0.15/1M in

// ─── STORAGE KEYS ────────────────────────────────────────────────────────
const SK_SESSION      = "msp_session_v2";
const SK_USERS        = "msp_users_v2";
const SK_PROFILE      = e => `msp_profile_${e.replace(/\W/g,"_")}`;
const SK_HISTORY      = e => `msp_history_${e.replace(/\W/g,"_")}`;
const SK_QUIZ_PROG    = e => `msp_quizprog_${e.replace(/\W/g,"_")}`;

// ─── SYSTEM PROMPT ───────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are MEDSCHOOL PREP — the ultimate all-in-one AI medical school preparation coach. You are warm, encouraging, and adapt perfectly to every student. You feel like texting your genius premed best friend who happens to know everything.

MISSION: Help with ANYTHING related to med school prep: MCAT, premed sciences, AMCAS essays, interviews (MMI/traditional), research tips, burnout support, school selection, and more.

MEMORY: The user profile is injected into your system prompt. Reference it naturally — use their name, reference their goals and weak areas.

CORE RULES:
• Always respond conversationally. End every reply with a natural follow-up question.
• Be warm, encouraging, never condescending. Celebrate wins. For wrong answers: kind "here's why" + clear remediation.
• For overwhelmed users: validate first, then give ONE quick win.
• Support deep study mode AND casual "just chat" mode seamlessly.
• Use light emojis naturally (not excessively).

CONTENT COVERAGE: Full 2026 MCAT (B/B, C/P, P/S, CARS), all premed sciences, AMCAS essays, interviews, research/shadowing, burnout support, application strategy.

TONE: Warm, rigorous when needed, always encouraging. Like a brilliant mentor friend.`;

// ─── UTILS ───────────────────────────────────────────────────────────────
function hashPassword(pw) {
  let h = 5381;
  for (let i = 0; i < pw.length; i++) {
    h = ((h << 5) + h) + pw.charCodeAt(i);
    h = h & 0xFFFFFFFF;
  }
  return h.toString(16);
}

async function stor(key, val, shared=false) {
  try { return await window.storage.set(key, JSON.stringify(val), shared); } catch {}
}
async function load(key, shared=false) {
  try {
    const r = await window.storage.get(key, shared);
    return r ? JSON.parse(r.value) : null;
  } catch { return null; }
}
async function del(key, shared=false) {
  try { await window.storage.delete(key, shared); } catch {}
}

function TypingDots() {
  return (
    <div style={{ display:"flex", gap:4, alignItems:"center", padding:"12px 16px" }}>
      {[0,1,2].map(i=>(
        <div key={i} style={{
          width:7,height:7,borderRadius:"50%",
          background:"var(--color-text-secondary)",
          animation:`bounce 1.2s ease-in-out ${i*0.2}s infinite`
        }}/>
      ))}
      <style>{`@keyframes bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-6px)}}`}</style>
    </div>
  );
}

// ─── AUTH MODAL ──────────────────────────────────────────────────────────
function AuthModal({ onSuccess, onClose }) {
  const [view, setView]       = useState("login"); // login|signup|forgot
  const [name, setName]       = useState("");
  const [email, setEmail]     = useState("");
  const [pw, setPw]           = useState("");
  const [pw2, setPw2]         = useState("");
  const [code, setCode]       = useState("");
  const [resetCode, setResetCode] = useState("");
  const [newPw, setNewPw]     = useState("");
  const [msg, setMsg]         = useState({ text:"", ok:true });
  const [loading, setLoading] = useState(false);

  const err = t => setMsg({ text:t, ok:false });
  const ok  = t => setMsg({ text:t, ok:true  });

  async function doSignup() {
    if (!name.trim()) return err("Please enter your name.");
    if (!email.includes("@")) return err("Enter a valid email.");
    if (pw.length < 6) return err("Password must be at least 6 characters.");
    if (pw !== pw2) return err("Passwords don't match.");
    setLoading(true);
    const users = (await load(SK_USERS)) || {};
    if (users[email.toLowerCase()]) { setLoading(false); return err("An account with this email already exists."); }
    users[email.toLowerCase()] = { name: name.trim(), hash: hashPassword(pw), createdAt: Date.now() };
    await stor(SK_USERS, users);
    const session = { email: email.toLowerCase(), name: name.trim(), loginAt: Date.now() };
    await stor(SK_SESSION, session);
    ok("Account created! Welcome aboard 🎉");
    setTimeout(() => onSuccess(session), 800);
    setLoading(false);
  }

  async function doLogin() {
    if (!email.includes("@")) return err("Enter a valid email.");
    if (!pw) return err("Enter your password.");
    setLoading(true);
    const users = (await load(SK_USERS)) || {};
    const user = users[email.toLowerCase()];
    if (!user || user.hash !== hashPassword(pw)) { setLoading(false); return err("Incorrect email or password."); }
    const session = { email: email.toLowerCase(), name: user.name, loginAt: Date.now() };
    await stor(SK_SESSION, session);
    ok(`Welcome back, ${user.name}! 👋`);
    setTimeout(() => onSuccess(session), 600);
    setLoading(false);
  }

  async function doForgotSend() {
    if (!email.includes("@")) return err("Enter a valid email.");
    setLoading(true);
    const users = (await load(SK_USERS)) || {};
    if (!users[email.toLowerCase()]) { setLoading(false); return err("No account found with this email."); }
    const code6 = Math.floor(100000 + Math.random() * 900000).toString();
    await stor(`msp_reset_${email.toLowerCase()}`, { code: code6, exp: Date.now() + 15*60*1000 });
    setResetCode(code6);
    ok(`Reset code generated! (For demo: ${code6})`);
    setView("reset_verify");
    setLoading(false);
  }

  async function doResetVerify() {
    const stored = await load(`msp_reset_${email.toLowerCase()}`);
    if (!stored || stored.code !== code || Date.now() > stored.exp) return err("Invalid or expired code.");
    if (newPw.length < 6) return err("New password must be at least 6 characters.");
    const users = (await load(SK_USERS)) || {};
    users[email.toLowerCase()].hash = hashPassword(newPw);
    await stor(SK_USERS, users);
    await del(`msp_reset_${email.toLowerCase()}`);
    ok("Password updated! You can now log in.");
    setTimeout(() => setView("login"), 1200);
  }

  const inputStyle = {
    width:"100%", padding:"11px 14px", borderRadius:10, fontSize:14,
    border:"1.5px solid var(--color-border-secondary)",
    background:"var(--color-background-secondary)",
    color:"var(--color-text-primary)", outline:"none", fontFamily:"inherit",
    boxSizing:"border-box",
  };
  const btnStyle = {
    width:"100%", padding:"12px", borderRadius:10, border:"none",
    background:"linear-gradient(135deg,#1D9E75,#185FA5)",
    color:"#fff", fontSize:14, fontWeight:600, cursor:"pointer",
    fontFamily:"inherit", marginTop:4,
    opacity: loading ? 0.7 : 1,
  };
  const linkStyle = { color:"#185FA5", cursor:"pointer", fontSize:13, textDecoration:"underline", background:"none", border:"none", fontFamily:"inherit" };

  return (
    <div style={{
      position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex",
      alignItems:"center", justifyContent:"center", zIndex:9999, padding:16,
    }}>
      <div style={{
        background:"var(--color-background-primary)", borderRadius:20,
        padding:"32px 28px", width:"100%", maxWidth:400,
        boxShadow:"0 24px 60px rgba(0,0,0,0.25)",
        border:"0.5px solid var(--color-border-secondary)",
      }}>
        <div style={{ textAlign:"center", marginBottom:24 }}>
          <div style={{ fontSize:32, marginBottom:8 }}>🩺</div>
          <div style={{ fontSize:20, fontWeight:700, color:"var(--color-text-primary)", marginBottom:4 }}>
            {view==="login"?"Welcome Back":view==="signup"?"Create Account":"Reset Password"}
          </div>
          <div style={{ fontSize:13, color:"var(--color-text-secondary)" }}>MedSchool Prep — Your AI Coach</div>
        </div>

        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {(view==="signup") && (
            <input style={inputStyle} placeholder="Full name" value={name} onChange={e=>setName(e.target.value)} />
          )}
          <input style={inputStyle} type="email" placeholder="Email address" value={email} onChange={e=>setEmail(e.target.value)} />
          {(view==="login"||view==="signup") && (
            <input style={inputStyle} type="password" placeholder="Password" value={pw} onChange={e=>setPw(e.target.value)} />
          )}
          {view==="signup" && (
            <input style={inputStyle} type="password" placeholder="Confirm password" value={pw2} onChange={e=>setPw2(e.target.value)} />
          )}
          {view==="reset_verify" && (<>
            <input style={inputStyle} placeholder="6-digit reset code" value={code} onChange={e=>setCode(e.target.value)} maxLength={6} />
            <input style={inputStyle} type="password" placeholder="New password" value={newPw} onChange={e=>setNewPw(e.target.value)} />
          </>)}

          {msg.text && (
            <div style={{ padding:"8px 12px", borderRadius:8, fontSize:13,
              background: msg.ok ? "#ECFDF5" : "#FEF2F2",
              color: msg.ok ? "#065F46" : "#991B1B", fontWeight:500
            }}>{msg.text}</div>
          )}

          <button style={btnStyle} disabled={loading} onClick={
            view==="signup" ? doSignup :
            view==="login"  ? doLogin  :
            view==="forgot" ? doForgotSend : doResetVerify
          }>
            {loading ? "Please wait…" :
              view==="signup"       ? "Create Account" :
              view==="login"        ? "Sign In" :
              view==="forgot"       ? "Send Reset Code" :
              "Reset Password"
            }
          </button>

          <div style={{ display:"flex", justifyContent:"center", gap:12, marginTop:6, flexWrap:"wrap" }}>
            {view==="login" && <>
              <button style={linkStyle} onClick={()=>{setView("signup");setMsg({text:"",ok:true})}}>Create account</button>
              <button style={linkStyle} onClick={()=>{setView("forgot");setMsg({text:"",ok:true})}}>Forgot password?</button>
            </>}
            {view==="signup" && <button style={linkStyle} onClick={()=>{setView("login");setMsg({text:"",ok:true})}}>Already have an account? Sign in</button>}
            {(view==="forgot"||view==="reset_verify") && <button style={linkStyle} onClick={()=>{setView("login");setMsg({text:"",ok:true})}}>Back to sign in</button>}
          </div>
          {onClose && <button style={{ ...linkStyle, display:"block", textAlign:"center", marginTop:4 }} onClick={onClose}>Continue as guest</button>}
        </div>
      </div>
    </div>
  );
}

// ─── QUIZ ENGINE ─────────────────────────────────────────────────────────
function QuizEngine({ quiz, onFinish }) {
  const [qi, setQi]       = useState(0);
  const [selected, setSel] = useState(null);
  const [confirmed, setCon] = useState(false);
  const [score, setScore]  = useState(0);
  const [answers, setAnswers] = useState([]);
  const [timeLeft, setTime] = useState(quiz.time);
  const [done, setDone]    = useState(false);
  const timerRef           = useRef(null);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setTime(t => {
        if (t <= 1) { clearInterval(timerRef.current); finishQuiz(); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, []);

  const finishQuiz = useCallback(() => {
    clearInterval(timerRef.current);
    setDone(true);
  }, []);

  function confirm() {
    if (selected === null) return;
    setCon(true);
    const correct = selected === quiz.questions[qi].correct;
    if (correct) setScore(s => s + 1);
    setAnswers(a => [...a, { qi, selected, correct }]);
  }

  function next() {
    if (qi + 1 >= quiz.questions.length) {
      finishQuiz();
    } else {
      setQi(q => q + 1);
      setSel(null);
      setCon(false);
    }
  }

  const q = quiz.questions[qi];
  const pct = Math.round((score / quiz.questions.length) * 100);
  const LETTERS = ["A","B","C","D"];
  const mm = Math.floor(timeLeft/60), ss = timeLeft%60;
  const timeColor = timeLeft < 60 ? "#EF4444" : timeLeft < 120 ? "#F59E0B" : "var(--color-text-secondary)";

  if (done) {
    const finalScore = Math.round((score / quiz.questions.length) * 100);
    const grade = finalScore >= 80 ? "🏆 Excellent!" : finalScore >= 60 ? "✅ Good work" : "📚 Keep studying";
    return (
      <div style={{ padding:24, maxWidth:620, margin:"0 auto" }}>
        <div style={{ textAlign:"center", marginBottom:28 }}>
          <div style={{ fontSize:48, marginBottom:8 }}>{grade.split(" ")[0]}</div>
          <div style={{ fontSize:22, fontWeight:700, color:"var(--color-text-primary)", marginBottom:4 }}>
            {grade.substring(2)}
          </div>
          <div style={{ fontSize:15, color:"var(--color-text-secondary)", marginBottom:20 }}>
            {quiz.title} Complete
          </div>
          <div style={{
            display:"inline-block", padding:"16px 32px", borderRadius:16,
            background: finalScore >= 80 ? "#ECFDF5" : finalScore >= 60 ? "#FFFBEB" : "#FEF2F2",
            marginBottom:20,
          }}>
            <div style={{ fontSize:48, fontWeight:800,
              color: finalScore >= 80 ? "#059669" : finalScore >= 60 ? "#D97706" : "#DC2626" }}>
              {finalScore}%
            </div>
            <div style={{ fontSize:14, color:"var(--color-text-secondary)" }}>
              {score} / {quiz.questions.length} correct
            </div>
          </div>
        </div>

        <div style={{ display:"flex", flexDirection:"column", gap:12, marginBottom:24 }}>
          {quiz.questions.map((question, i) => {
            const ans = answers.find(a => a.qi === i);
            const wasCorrect = ans?.correct;
            return (
              <div key={i} style={{
                padding:"12px 16px", borderRadius:12,
                border:`1.5px solid ${wasCorrect ? "#10B981" : "#EF4444"}`,
                background: wasCorrect ? "#ECFDF5" : "#FEF2F2",
              }}>
                <div style={{ fontSize:12, fontWeight:600,
                  color: wasCorrect ? "#065F46" : "#991B1B", marginBottom:4 }}>
                  Q{i+1} {wasCorrect ? "✓ Correct" : `✗ Incorrect — Answer: ${LETTERS[question.correct]}`}
                </div>
                <div style={{ fontSize:13, color:"var(--color-text-primary)", marginBottom:6 }}>{question.q}</div>
                <div style={{ fontSize:12, color:"var(--color-text-secondary)", lineHeight:1.5 }}>
                  <strong>Explanation:</strong> {question.exp}
                </div>
              </div>
            );
          })}
        </div>

        <button onClick={onFinish} style={{
          width:"100%", padding:"14px", borderRadius:12, border:"none",
          background:"linear-gradient(135deg,#1D9E75,#185FA5)",
          color:"#fff", fontSize:15, fontWeight:700, cursor:"pointer",
        }}>
          Back to Quiz Library
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding:16, maxWidth:640, margin:"0 auto" }}>
      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
        <div style={{ fontSize:13, color:"var(--color-text-secondary)", fontWeight:500 }}>
          Question {qi+1} of {quiz.questions.length}
        </div>
        <div style={{ fontSize:13, fontWeight:700, color:timeColor }}>
          ⏱ {mm}:{ss.toString().padStart(2,"0")}
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ height:5, background:"var(--color-background-secondary)", borderRadius:4, marginBottom:20, overflow:"hidden" }}>
        <div style={{
          height:"100%", borderRadius:4,
          background:"linear-gradient(90deg,#1D9E75,#185FA5)",
          width:`${((qi) / quiz.questions.length) * 100}%`,
          transition:"width 0.4s ease",
        }}/>
      </div>

      {/* Question */}
      <div style={{
        padding:"20px 20px", borderRadius:16,
        background:"var(--color-background-primary)",
        border:"0.5px solid var(--color-border-secondary)",
        marginBottom:16, fontSize:15, lineHeight:1.7,
        color:"var(--color-text-primary)", fontWeight:500,
      }}>
        {q.q}
      </div>

      {/* Choices */}
      <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:20 }}>
        {q.choices.map((choice, i) => {
          let bg = "var(--color-background-primary)";
          let border = "0.5px solid var(--color-border-secondary)";
          let color = "var(--color-text-primary)";
          if (selected === i && !confirmed) {
            bg = "#EFF6FF"; border = "2px solid #3B82F6"; color = "#1D4ED8";
          }
          if (confirmed) {
            if (i === q.correct) { bg="#ECFDF5"; border="2px solid #10B981"; color="#065F46"; }
            else if (i === selected && selected !== q.correct) { bg="#FEF2F2"; border="2px solid #EF4444"; color="#991B1B"; }
          }
          return (
            <button key={i} disabled={confirmed}
              onClick={() => setSel(i)}
              style={{
                display:"flex", alignItems:"flex-start", gap:12, padding:"12px 14px",
                borderRadius:12, border, background:bg, color, cursor:confirmed?"default":"pointer",
                textAlign:"left", fontFamily:"inherit", fontSize:14, lineHeight:1.5,
                transition:"all 0.2s",
              }}>
              <span style={{
                width:24, height:24, borderRadius:8, display:"flex", alignItems:"center",
                justifyContent:"center", fontWeight:700, fontSize:12, flexShrink:0,
                background: confirmed && i===q.correct ? "#10B981" :
                             confirmed && i===selected && selected!==q.correct ? "#EF4444" :
                             selected===i && !confirmed ? "#3B82F6" : "var(--color-background-secondary)",
                color: (confirmed&&(i===q.correct||(i===selected&&selected!==q.correct)))||(selected===i&&!confirmed) ? "#fff" : "var(--color-text-secondary)",
              }}>{LETTERS[i]}</span>
              {choice}
            </button>
          );
        })}
      </div>

      {/* Explanation */}
      {confirmed && (
        <div style={{
          padding:"14px 16px", borderRadius:12,
          background: selected===q.correct ? "#ECFDF5" : "#FEF2F2",
          border: `1.5px solid ${selected===q.correct ? "#10B981" : "#EF4444"}`,
          marginBottom:16, fontSize:13, lineHeight:1.6,
          color: selected===q.correct ? "#065F46" : "#7F1D1D",
        }}>
          <strong>{selected===q.correct ? "✓ Correct! " : "✗ Incorrect. "}</strong>
          {q.exp}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display:"flex", gap:10 }}>
        {!confirmed ? (
          <button onClick={confirm} disabled={selected===null} style={{
            flex:1, padding:"13px", borderRadius:12, border:"none",
            background: selected===null ? "var(--color-background-secondary)" : "linear-gradient(135deg,#1D9E75,#185FA5)",
            color: selected===null ? "var(--color-text-secondary)" : "#fff",
            fontSize:14, fontWeight:600, cursor: selected===null ? "not-allowed" : "pointer",
            fontFamily:"inherit",
          }}>
            Confirm Answer
          </button>
        ) : (
          <button onClick={next} style={{
            flex:1, padding:"13px", borderRadius:12, border:"none",
            background:"linear-gradient(135deg,#1D9E75,#185FA5)",
            color:"#fff", fontSize:14, fontWeight:600, cursor:"pointer",
            fontFamily:"inherit",
          }}>
            {qi + 1 >= quiz.questions.length ? "View Results →" : "Next Question →"}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── QUIZ BROWSER ────────────────────────────────────────────────────────
function QuizBrowser({ session, onStartQuiz }) {
  const [cat, setCat] = useState("all");
  const [diff, setDiff] = useState("all");
  const [progress, setProgress] = useState({});

  useEffect(() => {
    if (!session) return;
    load(SK_QUIZ_PROG(session.email)).then(p => setProgress(p||{}));
  }, [session]);

  const allQuizzes = Object.entries(QUIZ_BANK).flatMap(([key, quizzes]) =>
    quizzes.map(q => ({ ...q, category: key }))
  );

  const filtered = allQuizzes.filter(q =>
    (cat === "all" || q.category === cat) &&
    (diff === "all" || q.difficulty === diff)
  );

  const catLabels = {
    biochemistry:"Biochemistry", physiology:"Physiology", mcat_mixed:"MCAT Mixed"
  };
  const catIcons = {
    biochemistry:"🧪", physiology:"❤️", mcat_mixed:"📝"
  };

  return (
    <div style={{ padding:16 }}>
      <div style={{ marginBottom:20 }}>
        <div style={{ fontSize:18, fontWeight:700, color:"var(--color-text-primary)", marginBottom:4 }}>
          Quiz Library
        </div>
        <div style={{ fontSize:13, color:"var(--color-text-secondary)" }}>
          {allQuizzes.length} exams · {allQuizzes.reduce((s,q)=>s+q.questions.length,0)} total questions
        </div>
      </div>

      {/* Filters */}
      <div style={{ display:"flex", gap:8, marginBottom:16, flexWrap:"wrap" }}>
        {["all","biochemistry","physiology","mcat_mixed"].map(c => (
          <button key={c} onClick={()=>setCat(c)} style={{
            padding:"6px 14px", borderRadius:20, border:"none",
            background: cat===c ? "#185FA5" : "var(--color-background-secondary)",
            color: cat===c ? "#fff" : "var(--color-text-primary)",
            fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"inherit",
          }}>
            {c==="all"?"All":catIcons[c]+" "+catLabels[c]}
          </button>
        ))}
        <div style={{ width:1, background:"var(--color-border-secondary)" }}/>
        {["all","Easy","Medium","Hard"].map(d => (
          <button key={d} onClick={()=>setDiff(d)} style={{
            padding:"6px 14px", borderRadius:20, border:"none",
            background: diff===d ? (d==="Hard"?"#EF4444":d==="Medium"?"#F59E0B":d==="Easy"?"#10B981":"#185FA5") : "var(--color-background-secondary)",
            color: diff===d ? "#fff" : "var(--color-text-primary)",
            fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"inherit",
          }}>
            {d==="all"?"All Levels":d}
          </button>
        ))}
      </div>

      {/* Quiz grid */}
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        {filtered.map(quiz => {
          const prog = progress[quiz.id];
          const done = !!prog;
          return (
            <div key={quiz.id} style={{
              padding:"14px 16px", borderRadius:14,
              background:"var(--color-background-primary)",
              border:`0.5px solid ${done ? "#10B981" : "var(--color-border-secondary)"}`,
              display:"flex", alignItems:"center", gap:14,
            }}>
              <div style={{ fontSize:24 }}>{quiz.icon||"📚"}</div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:14, fontWeight:600, color:"var(--color-text-primary)", marginBottom:2 }}>
                  {quiz.title}
                </div>
                <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                  <span style={{
                    fontSize:11, padding:"2px 8px", borderRadius:20, fontWeight:600,
                    background: quiz.difficulty==="Hard"?"#FEF2F2":quiz.difficulty==="Medium"?"#FFFBEB":"#ECFDF5",
                    color: quiz.difficulty==="Hard"?"#991B1B":quiz.difficulty==="Medium"?"#92400E":"#065F46",
                  }}>{quiz.difficulty}</span>
                  <span style={{ fontSize:11, color:"var(--color-text-secondary)" }}>
                    {quiz.questions.length} Qs · {Math.floor(quiz.time/60)} min
                  </span>
                  {done && <span style={{ fontSize:11, color:"#059669", fontWeight:600 }}>
                    ✓ {prog.score}%
                  </span>}
                </div>
              </div>
              <button onClick={()=>onStartQuiz(quiz)} style={{
                padding:"8px 16px", borderRadius:10, border:"none",
                background:"linear-gradient(135deg,#1D9E75,#185FA5)",
                color:"#fff", fontSize:12, fontWeight:600, cursor:"pointer",
                fontFamily:"inherit", whiteSpace:"nowrap",
              }}>
                {done?"Retake":"Start"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── CHAT BUBBLE ────────────────────────────────────────────────────────
function ChatBubble({ msg }) {
  const isUser = msg.role === "user";
  const html = msg.content
    .replace(/\*\*(.*?)\*\*/g,"<strong>$1</strong>")
    .replace(/\*(.*?)\*/g,"<em>$1</em>")
    .replace(/\n/g,"<br/>");
  return (
    <div style={{ display:"flex", justifyContent:isUser?"flex-end":"flex-start", marginBottom:14 }}>
      {!isUser && (
        <div style={{
          width:30, height:30, borderRadius:"50%", flexShrink:0,
          background:"linear-gradient(135deg,#1D9E75,#185FA5)",
          display:"flex", alignItems:"center", justifyContent:"center",
          fontSize:13, color:"#fff", fontWeight:700, marginRight:8, marginTop:2,
        }}>M</div>
      )}
      <div style={{
        maxWidth:"80%",
        background: isUser ? "#185FA5" : "var(--color-background-primary)",
        color: isUser ? "#fff" : "var(--color-text-primary)",
        border: isUser ? "none" : "0.5px solid var(--color-border-secondary)",
        borderRadius: isUser ? "18px 18px 4px 18px" : "4px 18px 18px 18px",
        padding:"10px 14px", fontSize:14, lineHeight:1.65,
      }}>
        <span dangerouslySetInnerHTML={{ __html:html }}/>
      </div>
    </div>
  );
}

// ─── MAIN APP ────────────────────────────────────────────────────────────
export default function App() {
  const [session, setSession]   = useState(null);
  const [profile, setProfile]   = useState({ onboarded:false, studyStreak:0, totalSessions:0, weakAreas:{}, strongAreas:{} });
  const [messages, setMessages] = useState([]);
  const [input, setInput]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [tab, setTab]           = useState("chat"); // chat | quiz
  const [activeQuiz, setActiveQuiz] = useState(null);
  const [showAuth, setShowAuth] = useState(false);
  const [quizProgress, setQuizProgress] = useState({});
  const [ready, setReady]       = useState(false);
  const [sidebarOpen, setSidebar] = useState(true);
  const bottomRef               = useRef(null);
  const inputRef                = useRef(null);

  // Load session on mount
  useEffect(() => {
    async function init() {
      const s = await load(SK_SESSION);
      if (s) {
        setSession(s);
        const p = await load(SK_PROFILE(s.email));
        if (p) setProfile(p);
        const h = await load(SK_HISTORY(s.email));
        if (h) setMessages(h);
        const qp = await load(SK_QUIZ_PROG(s.email));
        if (qp) setQuizProgress(qp||{});
      }
      setReady(true);
    }
    init();
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [messages, loading]);

  async function handleAuthSuccess(s) {
    setSession(s);
    setShowAuth(false);
    const p = await load(SK_PROFILE(s.email));
    if (p) setProfile(p);
    const h = await load(SK_HISTORY(s.email));
    if (h) setMessages(h);
    const qp = await load(SK_QUIZ_PROG(s.email));
    if (qp) setQuizProgress(qp||{});
  }

  async function handleLogout() {
    await del(SK_SESSION);
    setSession(null);
    setMessages([]);
    setProfile({ onboarded:false, studyStreak:0, totalSessions:0, weakAreas:{}, strongAreas:{} });
    setQuizProgress({});
  }

  const sendMessage = useCallback(async (text) => {
    if (!text?.trim() || loading) return;
    setInput("");
    const userMsg = { role:"user", content:text };
    const newMsgs = [...messages, userMsg];
    setMessages(newMsgs);
    setLoading(true);

    const profileCtx = session
      ? `\n\n[USER PROFILE: ${JSON.stringify(profile)}]`
      : "\n\n[USER PROFILE: Guest user — no account. Encourage them to create one for personalized tracking.]";

    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          "Authorization":`Bearer ${OPENAI_API_KEY}`,
        },
        body:JSON.stringify({
          model:OPENAI_MODEL,
          max_tokens:1000,
          messages:[
            { role:"system", content:SYSTEM_PROMPT + profileCtx },
            ...newMsgs.map(m=>({ role:m.role, content:m.content })),
          ],
        }),
      });
      const data = await res.json();
      const reply = data.choices?.[0]?.message?.content ||
        "I hit a snag — please try again! I'm here and ready to help. 🤗";
      const botMsg = { role:"assistant", content:reply };
      const final = [...newMsgs, botMsg];
      setMessages(final);

      if (session) {
        await stor(SK_HISTORY(session.email), final.slice(-40));
        const updatedProfile = { ...profile, totalSessions:(profile.totalSessions||0)+1, onboarded:true };
        setProfile(updatedProfile);
        await stor(SK_PROFILE(session.email), updatedProfile);
      }
    } catch {
      setMessages([...newMsgs, { role:"assistant", content:"Connection hiccup! Could you try again? I'm ready to help 😊" }]);
    }
    setLoading(false);
    inputRef.current?.focus();
  }, [messages, loading, session, profile]);

  async function handleQuizFinish(quiz, score, total) {
    const pct = Math.round((score/total)*100);
    if (session) {
      const updated = { ...quizProgress, [quiz.id]:{ score:pct, completedAt:Date.now(), attempts:(quizProgress[quiz.id]?.attempts||0)+1 } };
      setQuizProgress(updated);
      await stor(SK_QUIZ_PROG(session.email), updated);
    }
    setActiveQuiz(null);
  }

  const quickPrompts = [
    "Quiz me on glycolysis 🧪",
    "Help me with MCAT CARS strategy 📖",
    "Make me a study plan ⏱️",
    "Explain the complement cascade 🔬",
    "Mock MMI question please 🎤",
    "I'm feeling burnt out 😔",
  ];

  const completedCount = Object.keys(quizProgress).length;
  const totalQuizzes = Object.values(QUIZ_BANK).reduce((s,arr)=>s+arr.length,0);
  const avgScore = completedCount > 0
    ? Math.round(Object.values(quizProgress).reduce((s,p)=>s+p.score,0)/completedCount)
    : null;

  if (!ready) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:400 }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ width:36, height:36, border:"3px solid #E6F1FB", borderTopColor:"#185FA5", borderRadius:"50%", animation:"spin 0.8s linear infinite", margin:"0 auto 12px" }}/>
        <p style={{ color:"var(--color-text-secondary)", fontSize:14 }}>Loading your profile…</p>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    </div>
  );

  return (
    <div style={{
      display:"flex", height:"min(700px,90vh)",
      background:"var(--color-background-tertiary)",
      borderRadius:"var(--border-radius-lg)", overflow:"hidden",
      border:"0.5px solid var(--color-border-tertiary)",
      fontFamily:"var(--font-sans)",
    }}>
      <style>{`
        .msp-input{background:var(--color-background-primary);border:0.5px solid var(--color-border-secondary);border-radius:12px;padding:10px 14px;font-size:14px;resize:none;width:100%;outline:none;font-family:var(--font-sans);color:var(--color-text-primary);line-height:1.5;}
        .msp-input:focus{border-color:var(--color-border-primary);}
        .msp-send{background:#185FA5;color:#fff;border:none;border-radius:10px;padding:8px 18px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;font-family:var(--font-sans);}
        .msp-send:disabled{opacity:0.5;cursor:not-allowed;}
        .msp-send:hover:not(:disabled){background:#0C447C;}
        .msp-tab{background:none;border:none;cursor:pointer;font-family:var(--font-sans);font-size:13px;font-weight:500;padding:8px 14px;border-radius:8px;color:var(--color-text-secondary);}
        .msp-tab.active{background:var(--color-background-secondary);color:var(--color-text-primary);}
        .msp-qbtn{background:var(--color-background-primary);border:0.5px solid var(--color-border-secondary);border-radius:20px;padding:6px 12px;font-size:11px;cursor:pointer;white-space:nowrap;color:var(--color-text-primary);font-family:var(--font-sans);}
        .msp-qbtn:hover{background:var(--color-background-secondary);}
        .msp-ibtn{background:none;border:none;cursor:pointer;color:var(--color-text-secondary);font-size:12px;padding:4px 8px;border-radius:6px;font-family:var(--font-sans);}
        .msp-ibtn:hover{background:var(--color-background-secondary);color:var(--color-text-primary);}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:var(--color-border-secondary);border-radius:2px}
      `}</style>

      {showAuth && <AuthModal onSuccess={handleAuthSuccess} onClose={()=>setShowAuth(false)}/>}

      {/* Sidebar */}
      {sidebarOpen && (
        <div style={{
          width:220, flexShrink:0,
          borderRight:"0.5px solid var(--color-border-tertiary)",
          background:"var(--color-background-primary)",
          display:"flex", flexDirection:"column", overflow:"hidden",
        }}>
          {/* Brand */}
          <div style={{ padding:"14px 14px 10px", borderBottom:"0.5px solid var(--color-border-tertiary)" }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div style={{
                width:28, height:28, borderRadius:"50%",
                background:"linear-gradient(135deg,#1D9E75,#185FA5)",
                display:"flex", alignItems:"center", justifyContent:"center",
                fontSize:13, color:"#fff", fontWeight:700,
              }}>M</div>
              <div>
                <div style={{ fontSize:13, fontWeight:600, color:"var(--color-text-primary)" }}>MedSchool Prep</div>
                <div style={{ fontSize:11, color:"var(--color-text-secondary)" }}>AI Coach · gpt-4o-mini</div>
              </div>
            </div>
          </div>

          {/* Profile / Stats */}
          <div style={{ flex:1, overflow:"auto", padding:"12px 14px" }}>
            {session ? (
              <>
                <div style={{ marginBottom:12 }}>
                  <div style={{ fontSize:11, color:"var(--color-text-secondary)", textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:4 }}>Student</div>
                  <div style={{ fontSize:13, fontWeight:600, color:"var(--color-text-primary)" }}>{session.name}</div>
                  <div style={{ fontSize:11, color:"var(--color-text-secondary)" }}>{session.email}</div>
                </div>

                {/* Quiz progress stats */}
                <div style={{ padding:"10px 12px", borderRadius:10, background:"var(--color-background-secondary)", marginBottom:12 }}>
                  <div style={{ fontSize:11, color:"var(--color-text-secondary)", marginBottom:6, textTransform:"uppercase", letterSpacing:"0.05em" }}>Quiz Progress</div>
                  <div style={{ display:"flex", justifyContent:"space-between" }}>
                    <div style={{ textAlign:"center" }}>
                      <div style={{ fontSize:20, fontWeight:700, color:"#185FA5" }}>{completedCount}</div>
                      <div style={{ fontSize:10, color:"var(--color-text-secondary)" }}>Completed</div>
                    </div>
                    <div style={{ textAlign:"center" }}>
                      <div style={{ fontSize:20, fontWeight:700, color:"#1D9E75" }}>{avgScore ?? "—"}{avgScore ? "%" : ""}</div>
                      <div style={{ fontSize:10, color:"var(--color-text-secondary)" }}>Avg Score</div>
                    </div>
                    <div style={{ textAlign:"center" }}>
                      <div style={{ fontSize:20, fontWeight:700, color:"#8B5CF6" }}>{totalQuizzes}</div>
                      <div style={{ fontSize:10, color:"var(--color-text-secondary)" }}>Total</div>
                    </div>
                  </div>
                  {/* Progress bar */}
                  <div style={{ marginTop:8, height:5, background:"var(--color-background-primary)", borderRadius:4, overflow:"hidden" }}>
                    <div style={{ height:"100%", background:"linear-gradient(90deg,#1D9E75,#185FA5)", width:`${(completedCount/totalQuizzes)*100}%`, borderRadius:4, transition:"width 0.5s" }}/>
                  </div>
                  <div style={{ fontSize:10, color:"var(--color-text-secondary)", marginTop:4 }}>
                    {completedCount}/{totalQuizzes} exams completed
                  </div>
                </div>

                {profile.totalSessions > 0 && (
                  <div style={{ marginBottom:12 }}>
                    <div style={{ fontSize:11, color:"var(--color-text-secondary)", marginBottom:4 }}>Chat sessions</div>
                    <div style={{ fontSize:18, fontWeight:700, color:"var(--color-text-primary)" }}>{profile.totalSessions}</div>
                  </div>
                )}

                {Object.keys(profile.weakAreas||{}).length > 0 && (
                  <div style={{ marginBottom:12 }}>
                    <div style={{ fontSize:11, color:"var(--color-text-secondary)", textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:6 }}>Weak Areas</div>
                    {Object.entries(profile.weakAreas).slice(0,3).map(([t,p])=>(
                      <div key={t} style={{ marginBottom:6 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, marginBottom:2 }}>
                          <span style={{ color:"var(--color-text-primary)" }}>{t}</span>
                          <span style={{ color:"var(--color-text-secondary)" }}>{p}%</span>
                        </div>
                        <div style={{ height:4, background:"var(--color-background-secondary)", borderRadius:2, overflow:"hidden" }}>
                          <div style={{ height:"100%", width:`${p}%`, background:p>=70?"#10B981":p>=40?"#F59E0B":"#EF4444", borderRadius:2 }}/>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div style={{ textAlign:"center", paddingTop:16 }}>
                <div style={{ fontSize:28, marginBottom:8 }}>👋</div>
                <div style={{ fontSize:13, color:"var(--color-text-secondary)", lineHeight:1.5, marginBottom:16 }}>
                  Sign in to track your progress and personalize your experience.
                </div>
                <button onClick={()=>setShowAuth(true)} style={{
                  width:"100%", padding:"9px", borderRadius:10, border:"none",
                  background:"linear-gradient(135deg,#1D9E75,#185FA5)",
                  color:"#fff", fontSize:13, fontWeight:600, cursor:"pointer",
                  fontFamily:"inherit",
                }}>
                  Sign In / Sign Up
                </button>
              </div>
            )}
          </div>

          {/* Bottom controls */}
          <div style={{ padding:"8px 14px 12px", borderTop:"0.5px solid var(--color-border-tertiary)" }}>
            {session ? (
              <>
                <button className="msp-ibtn" onClick={()=>setMessages([])} style={{ width:"100%", textAlign:"left", marginBottom:2 }}>🗑 Clear chat</button>
                <button className="msp-ibtn" onClick={handleLogout} style={{ width:"100%", textAlign:"left" }}>⎋ Log out</button>
              </>
            ) : (
              <button className="msp-ibtn" onClick={()=>setShowAuth(true)} style={{ width:"100%", textAlign:"left" }}>🔐 Sign In</button>
            )}
          </div>
        </div>
      )}

      {/* Main content */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
        {/* Topbar */}
        <div style={{
          padding:"8px 14px", borderBottom:"0.5px solid var(--color-border-tertiary)",
          background:"var(--color-background-primary)",
          display:"flex", alignItems:"center", justifyContent:"space-between",
        }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <button className="msp-ibtn" onClick={()=>setSidebar(o=>!o)} style={{ padding:"4px 6px" }}>☰</button>
            <div style={{ display:"flex", gap:2 }}>
              <button className={`msp-tab${tab==="chat"?" active":""}`} onClick={()=>setTab("chat")}>💬 Coach</button>
              <button className={`msp-tab${tab==="quiz"?" active":""}`} onClick={()=>{setTab("quiz");setActiveQuiz(null)}}>📚 Quizzes</button>
            </div>
          </div>
          <div style={{ display:"flex", gap:6, alignItems:"center" }}>
            {!session && (
              <button onClick={()=>setShowAuth(true)} style={{
                padding:"5px 12px", borderRadius:8, border:"none",
                background:"linear-gradient(135deg,#1D9E75,#185FA5)",
                color:"#fff", fontSize:12, fontWeight:600, cursor:"pointer",
                fontFamily:"inherit",
              }}>Sign Up</button>
            )}
            <div style={{ width:7, height:7, borderRadius:"50%", background:"#1D9E75" }}/>
            <span style={{ fontSize:12, color:"var(--color-text-secondary)" }}>AI online</span>
          </div>
        </div>

        {/* Tab content */}
        {tab === "quiz" ? (
          <div style={{ flex:1, overflow:"auto" }}>
            {activeQuiz ? (
              <QuizEngine
                quiz={activeQuiz}
                onFinish={() => {
                  handleQuizFinish(activeQuiz, 0, activeQuiz.questions.length);
                }}
              />
            ) : (
              <QuizBrowser session={session} onStartQuiz={q=>setActiveQuiz(q)} />
            )}
          </div>
        ) : (
          <>
            {/* Chat messages */}
            <div style={{ flex:1, overflow:"auto", padding:"16px 16px 8px" }}>
              {messages.length === 0 && (
                <div style={{ textAlign:"center", paddingTop:32, paddingBottom:20 }}>
                  <div style={{ fontSize:40, marginBottom:12 }}>🩺</div>
                  <div style={{ fontSize:18, fontWeight:700, color:"var(--color-text-primary)", marginBottom:6 }}>
                    {session ? `Welcome back, ${session.name}!` : "Welcome to MedSchool Prep"}
                  </div>
                  <div style={{ fontSize:14, color:"var(--color-text-secondary)", marginBottom:24, maxWidth:360, margin:"0 auto 24px" }}>
                    {session
                      ? "Ready to study? Ask me anything or use a quick prompt below."
                      : "Your all-in-one AI med school coach. Sign in to save progress, or just say hi!"}
                  </div>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:8, justifyContent:"center" }}>
                    {quickPrompts.map(q=>(
                      <button key={q} className="msp-qbtn" onClick={()=>sendMessage(q)}>{q}</button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((m,i)=><ChatBubble key={i} msg={m}/>)}
              {loading && (
                <div style={{ display:"flex", justifyContent:"flex-start", marginBottom:14 }}>
                  <div style={{ width:30,height:30,borderRadius:"50%",flexShrink:0,background:"linear-gradient(135deg,#1D9E75,#185FA5)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,color:"#fff",fontWeight:700,marginRight:8,marginTop:2 }}>M</div>
                  <div style={{ background:"var(--color-background-primary)",border:"0.5px solid var(--color-border-tertiary)",borderRadius:"4px 18px 18px 18px" }}>
                    <TypingDots/>
                  </div>
                </div>
              )}
              <div ref={bottomRef}/>
            </div>

            {/* Quick prompts (when chat has messages) */}
            {messages.length > 0 && (
              <div style={{ padding:"4px 16px", display:"flex", gap:6, overflowX:"auto" }}>
                {quickPrompts.slice(0,4).map(q=>(
                  <button key={q} className="msp-qbtn" onClick={()=>sendMessage(q)} style={{ fontSize:11 }}>{q}</button>
                ))}
              </div>
            )}

            {/* Input */}
            <div style={{ padding:"8px 16px 14px", borderTop:"0.5px solid var(--color-border-tertiary)", background:"var(--color-background-primary)" }}>
              <div style={{ display:"flex", gap:8, alignItems:"flex-end" }}>
                <textarea ref={inputRef} className="msp-input" rows={1}
                  placeholder={session ? "Ask anything — concepts, quizzes, essays, interviews…" : "Say hi to start! (Sign in to save progress)"}
                  value={input}
                  onChange={e=>setInput(e.target.value)}
                  onKeyDown={e=>{ if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage(input)} }}
                  onInput={e=>{ e.target.style.height="auto"; e.target.style.height=Math.min(e.target.scrollHeight,100)+"px"; }}
                  style={{ flex:1 }}
                />
                <button className="msp-send" onClick={()=>sendMessage(input)} disabled={loading||!input.trim()}>
                  {loading?"…":"Send ↗"}
                </button>
              </div>
              <div style={{ fontSize:11, color:"var(--color-text-secondary)", marginTop:4, textAlign:"center" }}>
                Enter to send · Shift+Enter for new line{session?` · Logged in as ${session.name}`:" · Sign in to save progress"}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
