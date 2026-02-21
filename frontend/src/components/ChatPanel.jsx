import { useState, useRef, useEffect } from 'react'
import { sendChat } from '../api'
import { v4 as uuidv4 } from 'uuid'

export default function ChatPanel({ snapshotId }) {
    const [open, setOpen] = useState(false)
    const [messages, setMessages] = useState([])
    const [input, setInput] = useState('')
    const [loading, setLoading] = useState(false)
    const [sessionId] = useState(() => uuidv4())
    const messagesEndRef = useRef(null)

    useEffect(() => {
        if (open && messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
        }
    }, [messages, open])

    const send = async () => {
        const question = input.trim()
        if (!question || !snapshotId) return
        setInput('')
        setMessages((prev) => [...prev, { role: 'user', content: question }])
        setLoading(true)

        try {
            const res = await sendChat(snapshotId, question, sessionId)
            setMessages((prev) => [
                ...prev,
                { role: 'assistant', content: res.data.answer, sources: res.data.sourceTables || [] },
            ])
        } catch (err) {
            setMessages((prev) => [
                ...prev,
                { role: 'assistant', content: 'Sorry, an error occurred. Make sure AI docs are generated first.', sources: [] },
            ])
        } finally {
            setLoading(false)
        }
    }

    const handleKey = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            send()
        }
    }

    if (!snapshotId) {
        return (
            <button
                style={fabStyle}
                onClick={() => { }}
                title="Connect to a database first"
                id="chat-fab"
            >
                <ChatIcon />
            </button>
        )
    }

    return (
        <>
            <button style={fabStyle} onClick={() => setOpen((v) => !v)} id="chat-fab" title="Ask DataLens AI">
                {open ? <CloseIcon /> : <ChatIcon />}
            </button>

            {open && (
                <div style={panelStyle}>
                    {/* Title bar */}
                    <div style={titleBarStyle}>
                        <div>
                            <div style={{ fontWeight: 700, fontSize: '0.9375rem' }}>DataLens AI Chat</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                                RAG-powered queries on your schema
                            </div>
                        </div>
                        <button onClick={() => setOpen(false)} style={closeBtnStyle}>✕</button>
                    </div>

                    {/* Messages */}
                    <div style={messagesStyle}>
                        {messages.length === 0 && (
                            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px 16px', fontSize: '0.875rem' }}>
                                <div style={{ fontSize: '2rem', marginBottom: 8 }}>🔍</div>
                                Ask anything about your database schema, quality issues, or data relationships.
                            </div>
                        )}
                        {messages.map((msg, i) => (
                            <div key={i} style={msgWrapStyle(msg.role)}>
                                <div style={msgBubbleStyle(msg.role)}>
                                    <p style={{ margin: 0, whiteSpace: 'pre-wrap', color: msg.role === 'user' ? '#fff' : 'var(--text-primary)' }}>
                                        {msg.content}
                                    </p>
                                    {msg.sources && msg.sources.length > 0 && (
                                        <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginRight: 4 }}>Sources:</span>
                                            {msg.sources.map((s, j) => (
                                                <span key={j} style={sourceChipStyle}>
                                                    {s.name} {s.relevanceScore}%
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                        {loading && (
                            <div style={msgWrapStyle('assistant')}>
                                <div style={{ ...msgBubbleStyle('assistant'), display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span className="spinner" />
                                    <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Thinking…</span>
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input */}
                    <div style={inputAreaStyle}>
                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKey}
                            placeholder="Ask about tables, quality, relationships…"
                            style={textareaStyle}
                            rows={2}
                            id="chat-input"
                        />
                        <button
                            onClick={send}
                            disabled={loading || !input.trim()}
                            style={sendBtnStyle}
                            id="chat-send-btn"
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </button>
                    </div>
                </div>
            )}
        </>
    )
}


const fabStyle = {
    position: 'fixed',
    bottom: 28,
    right: 28,
    width: 56,
    height: 56,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 8px 32px rgba(99,102,241,0.4)',
    zIndex: 900,
    transition: 'all 0.2s ease',
    color: '#fff',
}

const panelStyle = {
    position: 'fixed',
    bottom: 96,
    right: 28,
    width: 400,
    height: 560,
    background: 'var(--bg-card)',
    border: '1px solid var(--border-accent)',
    borderRadius: 16,
    boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
    zIndex: 900,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    animation: 'fadeIn 0.25s ease',
}

const titleBarStyle = {
    padding: '16px 20px',
    borderBottom: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: 'var(--bg-elevated)',
    flexShrink: 0,
}

const closeBtnStyle = {
    background: 'none',
    border: 'none',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '1rem',
    padding: 4,
}

const messagesStyle = {
    flex: 1,
    overflowY: 'auto',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
}

const msgWrapStyle = (role) => ({
    display: 'flex',
    justifyContent: role === 'user' ? 'flex-end' : 'flex-start',
})

const msgBubbleStyle = (role) => ({
    maxWidth: '85%',
    padding: '10px 14px',
    borderRadius: role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
    background: role === 'user' ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : 'var(--bg-elevated)',
    border: role === 'user' ? 'none' : '1px solid var(--border)',
    fontSize: '0.875rem',
    lineHeight: 1.5,
})

const sourceChipStyle = {
    fontSize: '0.7rem',
    padding: '2px 8px',
    borderRadius: 100,
    background: 'rgba(99,102,241,0.15)',
    color: 'var(--accent-hover)',
    border: '1px solid rgba(99,102,241,0.2)',
}

const inputAreaStyle = {
    padding: '12px 16px',
    borderTop: '1px solid var(--border)',
    display: 'flex',
    gap: 10,
    alignItems: 'flex-end',
    background: 'var(--bg-elevated)',
    flexShrink: 0,
}

const textareaStyle = {
    flex: 1,
    padding: '10px 14px',
    background: 'var(--bg-base)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    color: 'var(--text-primary)',
    fontFamily: 'var(--font)',
    fontSize: '0.875rem',
    resize: 'none',
    outline: 'none',
    lineHeight: 1.5,
}

const sendBtnStyle = {
    width: 42,
    height: 42,
    borderRadius: 10,
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    flexShrink: 0,
    transition: 'opacity 0.2s',
}

const ChatIcon = () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
)

const CloseIcon = () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <path d="M18 6L6 18M6 6l12 12" />
    </svg>
)
