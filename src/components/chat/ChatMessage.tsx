import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useState } from 'react';
import { ChevronDown, ChevronUp, Bot, User } from 'lucide-react';

interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  onExecute?: () => void;
  isExecuting?: boolean;  // NEW: Show loading state
}

export function ChatMessage({ role, content, onExecute, isExecuting }: ChatMessageProps) {
  const [isExpanded, setIsExpanded] = useState(content.length < 400);
  const isLong = content.length > 400;
  const displayContent = isExpanded ? content : content.slice(0, 350) + '...';

  return (
    <div className={`flex gap-3 ${role === 'user' ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-white text-xs
        ${role === 'user' ? 'bg-blue-500' : 'bg-gradient-to-br from-purple-500 to-pink-500'}`}>
        {role === 'user' ? <User size={14} /> : <Bot size={14} />}
      </div>

      {/* Message Content */}
      <div className={`flex-1 min-w-0 ${role === 'user' ? 'text-right' : ''}`}>
        <div className={`inline-block max-w-full rounded-xl px-4 py-3 text-sm
          ${role === 'user'
            ? 'bg-blue-500 text-white rounded-tr-sm'
            : 'bg-slate-100 dark:bg-slate-800 text-foreground rounded-tl-sm border border-slate-200 dark:border-slate-700'
          }`}>

          {role === 'assistant' ? (
            <div className="prose prose-sm dark:prose-invert max-w-none
              prose-p:my-1 prose-ul:my-1 prose-li:my-0.5
              prose-headings:text-sm prose-headings:font-semibold prose-headings:mt-2 prose-headings:mb-1
              prose-code:text-xs prose-code:bg-slate-200 dark:prose-code:bg-slate-700 prose-code:px-1 prose-code:py-0.5 prose-code:rounded
              prose-pre:bg-slate-900 prose-pre:text-slate-100 prose-pre:text-xs prose-pre:p-2 prose-pre:rounded-md
              [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {displayContent}
              </ReactMarkdown>
            </div>
          ) : (
            <p className="whitespace-pre-wrap break-words">{displayContent}</p>
          )}

          {/* Expand/Collapse for long messages */}
          {isLong && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="mt-2 text-xs flex items-center gap-1 text-blue-500 hover:text-blue-600"
            >
              {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {isExpanded ? '折りたたむ' : 'すべて表示'}
            </button>
          )}
        </div>

        {/* Inline Execute Button for Assistant */}
        {role === 'assistant' && onExecute && (
          <div className="mt-2">
            <button
              onClick={onExecute}
              disabled={isExecuting}
              className={`text-xs px-3 py-1.5 text-white rounded-full font-medium transition-all flex items-center gap-1.5
                ${isExecuting
                  ? 'bg-amber-500 cursor-not-allowed'
                  : 'bg-green-500 hover:bg-green-600'}`}
            >
              {isExecuting ? (
                <>
                  <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  実行中...
                </>
              ) : (
                'このプランで実行'
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
