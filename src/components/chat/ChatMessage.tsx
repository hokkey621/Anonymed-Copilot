import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
}

export function ChatMessage({ role, content }: ChatMessageProps) {
  const [isExpanded, setIsExpanded] = useState(content.length < 500);
  const isLong = content.length > 500;
  const displayContent = isExpanded ? content : content.slice(0, 450) + '...';

  return (
    <div className={`text-sm ${role === 'user' ? 'pl-4' : ''}`}>
      {/* Role indicator */}
      <div className={`text-xs font-medium mb-1 ${role === 'user' ? 'text-blue-500' : 'text-muted-foreground'}`}>
        {role === 'user' ? 'You' : 'Agent'}
      </div>

      {/* Message Content */}
      <div className={`rounded-md px-3 py-2 ${
        role === 'user'
          ? 'bg-blue-500/10 border-l-2 border-blue-500'
          : 'bg-muted/50'
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
    </div>
  );
}
