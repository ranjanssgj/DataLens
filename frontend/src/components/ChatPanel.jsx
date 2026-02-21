import { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function ChatPanel({ snapshotId }) {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [sessionId] = useState(() => `session_${Date.now()}`);
    const messagesEndRef = useRef(null);

    // Auto-scroll to bottom on new messages
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const sendMessage = async () => {
        const question = input.trim();
        if (!question || loading) return;

        if (!snapshotId) {
            console.error("[ChatPanel] Error: 'snapshotId' is null or undefined. Cannot send chat request to API.");
            setMessages(prev => [...prev, {
                role: 'assistant',
                content: "Error: Chat could not send message because 'snapshotId' is missing.",
                sourceTables: []
            }]);
            return;
        }

        setInput('');
        setMessages(prev => [...prev, { role: 'user', content: question }]);
        setLoading(true);

        try {
            const res = await axios.post(`${API_BASE}/api/snapshots/${snapshotId}/chat`, {
                question,
                sessionId,
            });
            const { answer, sourceTables } = res.data;
            setMessages(prev => [...prev, { role: 'assistant', content: answer, sourceTables }]);
        } catch (err) {
            const errMsg = err.response?.data?.detail || err.response?.data?.error || err.message;
            setMessages(prev => [...prev, {
                role: 'assistant',
                content: `Error: ${errMsg}. Make sure AI docs are generated first.`,
                sourceTables: []
            }]);
        } finally {
            setLoading(false);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    return (
        <>
            {/* Floating button — fixed position, always visible */}
            <button
                onClick={() => setIsOpen(prev => !prev)}
                style={{
                    position: 'fixed',
                    bottom: 24,
                    right: 24,
                    width: 56,
                    height: 56,
                    borderRadius: '50%',
                    background: isOpen ? '#4f46e5' : '#6366f1',
                    border: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 4px 24px rgba(99,102,241,0.4)',
                    zIndex: 9999,
                    fontSize: 22,
                    transition: 'background 0.2s',
                }}
                title={isOpen ? 'Close chat' : 'Ask AI about this database'}
            >
                {isOpen ? '✕' : '💬'}
            </button>

            {/* Chat window */}
            {isOpen && (
                <div
                    style={{
                        position: 'fixed',
                        bottom: 92,
                        right: 24,
                        width: 420,
                        height: 560,
                        background: '#0f172a',
                        border: '1px solid #1e293b',
                        borderRadius: 16,
                        display: 'flex',
                        flexDirection: 'column',
                        zIndex: 9998,
                        boxShadow: '0 8px 48px rgba(0,0,0,0.5)',
                        overflow: 'hidden',
                    }}
                >
                    {/* Header */}
                    <div style={{
                        padding: '16px 20px',
                        borderBottom: '1px solid #1e293b',
                        background: '#0f172a',
                    }}>
                        <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 15 }}>
                            DataLens AI Chat
                        </div>
                        <div style={{ color: '#475569', fontSize: 12, marginTop: 2 }}>
                            Ask anything about your database schema or data quality
                        </div>
                    </div>

                    {/* Messages */}
                    <div style={{
                        flex: 1,
                        overflowY: 'auto',
                        padding: 16,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 12,
                    }}>
                        {messages.length === 0 && (
                            <div style={{ color: '#334155', textAlign: 'center', marginTop: 40, fontSize: 13 }}>
                                <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
                                Ask a question like:<br /><br />
                                <em>"Which table has revenue data?"</em><br />
                                <em>"Are there any data quality issues?"</em><br />
                                <em>"How do I join orders and customers?"</em>
                            </div>
                        )}

                        {messages.map((msg, i) => (
                            <div key={i} style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                            }}>
                                <div style={{
                                    maxWidth: '88%',
                                    padding: '10px 14px',
                                    borderRadius: msg.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                                    background: msg.role === 'user' ? '#4f46e5' : '#1e293b',
                                    color: '#e2e8f0',
                                    fontSize: 13,
                                    lineHeight: 1.6,
                                    wordBreak: 'break-word',
                                }}>
                                    {msg.role === 'user' ? (
                                        <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                                    ) : (
                                        <ReactMarkdown
                                            remarkPlugins={[remarkGfm]}
                                            components={{
                                                pre({ node, ...props }) {
                                                    return <pre style={{ background: '#0f172a', padding: '10px', borderRadius: '6px', overflowX: 'auto', marginTop: '8px', marginBottom: '8px' }} {...props} />
                                                },
                                                code({ node, inline, ...props }) {
                                                    return inline
                                                        ? <code style={{ background: '#0f172a', padding: '2px 4px', borderRadius: '4px', color: '#a5b4fc' }} {...props} />
                                                        : <code {...props} />
                                                },
                                                table({ node, ...props }) {
                                                    return <table style={{ borderCollapse: 'collapse', width: '100%', marginTop: '8px', marginBottom: '8px' }} {...props} />
                                                },
                                                th({ node, ...props }) {
                                                    return <th style={{ borderBottom: '1px solid #334155', textAlign: 'left', padding: '6px 8px', color: '#94a3b8' }} {...props} />
                                                },
                                                td({ node, ...props }) {
                                                    return <td style={{ borderBottom: '1px solid #334155', padding: '6px 8px' }} {...props} />
                                                },
                                                a({ node, ...props }) {
                                                    return <a style={{ color: '#818cf8', textDecoration: 'none' }} {...props} />
                                                }
                                            }}
                                        >
                                            {msg.content}
                                        </ReactMarkdown>
                                    )}
                                </div>

                                {/* Source tables */}
                                {msg.sourceTables?.length > 0 && (
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                                        {msg.sourceTables.map(t => (
                                            <span key={t.name} style={{
                                                background: '#0f172a',
                                                border: '1px solid #334155',
                                                color: '#6366f1',
                                                fontSize: 10,
                                                borderRadius: 4,
                                                padding: '2px 6px',
                                            }}>
                                                {t.name} {t.relevanceScore}%
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}

                        {loading && (
                            <div style={{ color: '#475569', fontSize: 12 }}>
                                ⏳ Thinking...
                            </div>
                        )}

                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input */}
                    <div style={{
                        padding: 12,
                        borderTop: '1px solid #1e293b',
                        display: 'flex',
                        gap: 8,
                    }}>
                        <input
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Ask about your database..."
                            disabled={loading}
                            style={{
                                flex: 1,
                                background: '#1e293b',
                                border: '1px solid #334155',
                                borderRadius: 8,
                                padding: '8px 12px',
                                color: '#e2e8f0',
                                fontSize: 13,
                                outline: 'none',
                            }}
                        />
                        <button
                            onClick={sendMessage}
                            disabled={loading || !input.trim()}
                            style={{
                                background: loading || !input.trim() ? '#1e293b' : '#6366f1',
                                border: 'none',
                                borderRadius: 8,
                                padding: '8px 14px',
                                color: loading || !input.trim() ? '#475569' : '#fff',
                                cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
                                fontSize: 14,
                            }}
                        >
                            ↑
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}
