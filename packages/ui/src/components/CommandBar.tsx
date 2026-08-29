import { useEffect, useRef, useState } from 'react';
import type { JSX, KeyboardEvent as ReactKeyboardEvent } from 'react';

import { COMMAND_HELP, parseCommand, type Command } from '@assemble/core/command';

interface Props {
  focused?: string;
  handles: string[];
  onRun(command: Command): void;
  notice?: string;
}

/**
 * One line to drive the whole crew.
 *
 * History on the arrow keys, tab completion for handles, and a hint strip that
 * shows the grammar until you know it. `/` and `@` both open the completion
 * list, so the operator never has to remember which agents are called what.
 */
export function CommandBar({ focused, handles, onRun, notice }: Props): JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [cursor, setCursor] = useState(-1);
  const [showHelp, setShowHelp] = useState(false);

  // A single keystroke should reach the command line from anywhere on the page.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const typingElsewhere =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.classList.contains('xterm-helper-textarea');

      if (typingElsewhere) return;

      if (event.key === '/' || event.key === '@') {
        event.preventDefault();
        setValue((current) => current + event.key);
        input.current?.focus();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const suggestions =
    value.startsWith('@') && !value.includes(' ')
      ? handles.filter((handle) => handle.startsWith(value.slice(1)))
      : [];

  const submit = (): void => {
    const text = value.trim();
    if (!text) return;

    const command = parseCommand(text, focused);
    onRun(command);

    if (command.kind === 'help') setShowHelp(true);
    else setShowHelp(false);

    setHistory((current) => [text, ...current].slice(0, 60));
    setCursor(-1);
    setValue('');
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
      return;
    }

    if (event.key === 'Tab' && suggestions[0]) {
      event.preventDefault();
      setValue(`@${suggestions[0]} `);
      return;
    }

    if (event.key === 'ArrowUp' && history.length > 0) {
      event.preventDefault();
      const next = Math.min(cursor + 1, history.length - 1);
      setCursor(next);
      setValue(history[next] ?? '');
      return;
    }

    if (event.key === 'ArrowDown' && cursor >= 0) {
      event.preventDefault();
      const next = cursor - 1;
      setCursor(next);
      setValue(next < 0 ? '' : (history[next] ?? ''));
      return;
    }

    if (event.key === 'Escape') {
      setValue('');
      setShowHelp(false);
      input.current?.blur();
    }
  };

  const target = value.startsWith('@')
    ? 'message'
    : value.startsWith('/')
      ? 'command'
      : focused
        ? focused
        : 'nowhere';

  return (
    <div className="commandbar">
      {showHelp ? (
        <div className="cmd-help">
          {COMMAND_HELP.map(([syntax, meaning]) => (
            <div key={syntax}>
              <code>{syntax}</code>
              <span>{meaning}</span>
            </div>
          ))}
        </div>
      ) : null}

      {suggestions.length > 0 ? (
        <div className="cmd-suggest">
          {suggestions.map((handle) => (
            <button key={handle} className="ghost" onClick={() => setValue(`@${handle} `)}>
              @{handle}
            </button>
          ))}
          <span className="hint">tab to complete</span>
        </div>
      ) : null}

      <div className="cmd-row">
        <span className={`cmd-target${target === 'nowhere' ? ' none' : ''}`}>{target}</span>

        <input
          ref={input}
          value={value}
          spellCheck={false}
          autoComplete="off"
          placeholder={
            focused
              ? `type into ${focused}, or @handle to message, / for commands`
              : 'click a terminal to type into it, or @handle to message, / for commands'
          }
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
        />

        <button className="ghost" onClick={() => setShowHelp((current) => !current)} title="Grammar">
          ?
        </button>
        <button className="primary" onClick={submit}>
          send
        </button>
      </div>

      {notice ? <div className="cmd-notice">{notice}</div> : null}
    </div>
  );
}
