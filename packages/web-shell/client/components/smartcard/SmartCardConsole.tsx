import {
  GripVertical,
  Send,
  Plus,
  Slash,
  ChevronRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight as ChevronRightIcon,
  Usb,
  Unplug,
  Plug,
} from 'lucide-react';
import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type FormEvent,
  type ChangeEvent,
} from 'react';
import styles from './SmartCardConsole.module.css';
import {
  connectReader,
  disconnectReader,
  listReaders,
  resetCard,
  sendApdu,
  subscribeToOperations,
  type ReaderInfo,
  type SmartCardOperation,
} from './smartcard-api.js';

// Supported slash commands
const SLASH_COMMANDS = [
  { name: 'help', description: 'Show available commands', icon: '❓' },
  {
    name: 'apdu',
    description: 'Send APDU command (hex string)',
    icon: '📡',
  },
  { name: 'reset', description: 'Reset the smart card', icon: '🔄' },
  { name: 'clear', description: 'Clear console output', icon: '🧹' },
  { name: 'version', description: 'Show console version', icon: 'ℹ️' },
  { name: 'status', description: 'Show reader status', icon: '📊' },
];

/** Render a smart-card operation into a console line. */
function formatOperation(op: SmartCardOperation): string {
  switch (op.type) {
    case 'apdu': {
      const sw = op.sw.toString(16).padStart(4, '0').toUpperCase();
      const request = op.request ? `> ${op.request.toUpperCase()}\n` : '';
      const response = op.response
        ? `< ${op.response.toUpperCase()} ${sw}`
        : `< ${sw}`;
      return request + response;
    }
    case 'connect':
      return `Connected to "${op.readerId}". ATR = ${op.atr || '(unavailable)'}`;
    case 'disconnect':
      return 'Disconnected from the smart card reader.';
    case 'reset':
      return `Card reset. ATR = ${op.atr || '(unavailable)'}`;
  }
}

export interface SmartCardConsoleProps {
  className?: string;
  width: number;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onWidthChange?: (width: number) => void;
}

type MenuType = 'none' | 'slash' | 'at';

export function SmartCardConsole({
  className,
  width,
  onResizeStart,
  onWidthChange,
}: SmartCardConsoleProps) {
  const [inputValue, setInputValue] = useState('');
  const [consoleLines, setConsoleLines] = useState<
    Array<{ timestamp: string; message: string; type?: 'input' | 'output' }>
  >([
    { timestamp: '[21:55:48]', message: 'SmartCard Console initialized' },
    {
      timestamp: '[21:55:49]',
      message: 'Ready for commands... Type /help for available commands',
    },
  ]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const consoleEndRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const readerMenuRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Toggle state: remember the width before expanding
  const [prevWidth, setPrevWidth] = useState<number | null>(null);

  const addConsoleLine = useCallback(
    (message: string, type?: 'input' | 'output') => {
      const now = new Date();
      const timestamp = `[${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}]`;
      // Split multi-line messages into separate entries
      const lines = message.split('\n');
      setConsoleLines((prev) => [
        ...prev,
        ...lines.map((line) => ({ timestamp, message: line, type })),
      ]);
    },
    [],
  );

  // Menu state
  const [menuType, setMenuType] = useState<MenuType>('none');
  const [menuQuery, setMenuQuery] = useState('');
  const [menuIndex, setMenuIndex] = useState(0);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showReaderMenu, setShowReaderMenu] = useState(false);

  // Smart-card reader state
  const [readers, setReaders] = useState<ReaderInfo[]>([]);
  const [selectedReader, setSelectedReader] = useState<ReaderInfo | null>(null);
  const [activeReaderId, setActiveReaderId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const isSelectedConnected = selectedReader?.id === activeReaderId;

  // Load readers and active connection on mount.
  const refreshReaders = useCallback(async () => {
    try {
      const { readers: nextReaders, activeReader: session } =
        await listReaders();
      setReaders(nextReaders);
      setActiveReaderId(session.connected ? session.readerId : null);
      setSelectedReader((prev) => {
        if (prev && nextReaders.some((r) => r.id === prev.id)) {
          return nextReaders.find((r) => r.id === prev.id) ?? prev;
        }
        return nextReaders[0] ?? null;
      });
    } catch {
      // No daemon / no PC/SC stack: keep the console usable in a degraded
      // state and let the next explicit command surface the error.
    }
  }, []);

  useEffect(() => {
    void refreshReaders();
  }, [refreshReaders]);

  // Auto-scroll console area when new lines are appended
  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [consoleLines]);

  // Subscribe to the daemon operation log so every APDU (manual, agent tool,
  // or skill) and every connect/disconnect/reset shows up in the console.
  useEffect(() => {
    const controller = new AbortController();
    subscribeToOperations(
      (op) => addConsoleLine(formatOperation(op), 'output'),
      controller.signal,
    ).catch(() => {
      // No daemon or stream unavailable: the console stays usable in a
      // degraded state; explicit commands surface errors themselves.
    });
    return () => controller.abort();
  }, [addConsoleLine]);

  const handleConnectToggle = useCallback(async () => {
    if (!selectedReader) return;
    setConnecting(true);
    try {
      if (isSelectedConnected) {
        await disconnectReader();
        setActiveReaderId(null);
      } else {
        await connectReader(selectedReader.id);
        setActiveReaderId(selectedReader.id);
      }
      await refreshReaders();
    } catch (error) {
      addConsoleLine(
        `Reader operation failed: ${error instanceof Error ? error.message : String(error)}`,
        'output',
      );
    } finally {
      setConnecting(false);
    }
  }, [selectedReader, isSelectedConnected, refreshReaders, addConsoleLine]);

  // Toggle console width: expand to 800px or restore previous width
  const handleWidthToggle = useCallback(() => {
    const MAX_WIDTH = 800;
    if (width < MAX_WIDTH) {
      // Expand: save current width, go to max
      setPrevWidth(width);
      onWidthChange?.(MAX_WIDTH);
    } else if (prevWidth !== null) {
      // Collapse: restore previous width
      onWidthChange?.(prevWidth);
      setPrevWidth(null);
    }
  }, [width, prevWidth, onWidthChange]);

  // Handle file selection from @ file picker — read file content and insert into textarea
  const handleFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      // Reset file input so the same file can be selected again
      event.target.value = '';

      const textarea = textareaRef.current;
      if (!textarea) return;

      const cursorPos = textarea.selectionStart;
      const textBeforeCursor = inputValue.substring(0, cursorPos);
      const textAfterCursor = inputValue.substring(cursorPos);

      // Find the @ that triggered the picker
      const lastAt = textBeforeCursor.lastIndexOf('@');
      const replaceFrom = lastAt;

      // Read file content and insert it after the @ mention
      const reader = new FileReader();
      reader.onload = () => {
        const fileContent = reader.result as string;
        const insertText = `@${file.name}\n${fileContent}\n`;

        const newValue =
          textBeforeCursor.substring(0, replaceFrom) +
          insertText +
          textAfterCursor;

        setInputValue(newValue);

        setTimeout(() => {
          const newCursorPos = replaceFrom + insertText.length;
          textarea.setSelectionRange(newCursorPos, newCursorPos);
          textarea.focus();
        }, 0);
      };
      reader.onerror = () => {
        addConsoleLine(`Failed to read file: ${file.name}`, 'output');
      };
      reader.readAsText(file);
    },
    [inputValue, addConsoleLine],
  );

  // Filter items based on query
  const filteredSlashCommands = SLASH_COMMANDS.filter((cmd) =>
    cmd.name.toLowerCase().includes(menuQuery.toLowerCase()),
  );

  const currentMenuItems = menuType === 'slash' ? filteredSlashCommands : [];

  // Handle input change
  const handleInputChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setInputValue(value);

    // Auto-resize textarea
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }

    // Detect / or @ at cursor position
    const cursorPos = event.target.selectionStart;
    const textBeforeCursor = value.substring(0, cursorPos);

    const lastSlash = textBeforeCursor.lastIndexOf('/');
    const lastAt = textBeforeCursor.lastIndexOf('@');

    if (lastSlash !== -1 && lastSlash > lastAt) {
      const afterSlash = textBeforeCursor.substring(lastSlash + 1);
      if (!afterSlash.includes(' ')) {
        setMenuType('slash');
        setMenuQuery(afterSlash);
        setMenuIndex(0);
      } else {
        setMenuType('none');
      }
    } else if (lastAt !== -1 && lastAt > lastSlash) {
      const afterAt = textBeforeCursor.substring(lastAt + 1);
      if (!afterAt.includes(' ')) {
        // @ triggers file picker
        setMenuType('none');
        fileInputRef.current?.click();
      } else {
        setMenuType('none');
      }
    } else {
      setMenuType('none');
    }
  };

  // Insert menu item (slash command only)
  const insertMenuItem = useCallback(
    (item: (typeof currentMenuItems)[0]) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const cursorPos = textarea.selectionStart;
      const textBeforeCursor = inputValue.substring(0, cursorPos);
      const textAfterCursor = inputValue.substring(cursorPos);

      const lastSlash = textBeforeCursor.lastIndexOf('/');
      const replaceFrom = lastSlash;
      const insertText = `/${item.name} `;

      const newValue =
        textBeforeCursor.substring(0, replaceFrom) +
        insertText +
        textAfterCursor;

      setInputValue(newValue);
      setMenuType('none');

      setTimeout(() => {
        const newCursorPos = replaceFrom + insertText.length;
        textarea.setSelectionRange(newCursorPos, newCursorPos);
        textarea.focus();
      }, 0);
    },
    [inputValue],
  );

  // Handle key down
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (menuType !== 'none' && currentMenuItems.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setMenuIndex((prev) =>
          prev < currentMenuItems.length - 1 ? prev + 1 : prev,
        );
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setMenuIndex((prev) => (prev > 0 ? prev - 1 : prev));
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        insertMenuItem(currentMenuItems[menuIndex]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenuType('none');
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSubmit({ preventDefault: () => {} } as FormEvent);
    }
  };

  // Handle submit — split multi-line input and execute each line in order
  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const raw = inputValue.trim();
    if (!raw) return;

    const lines = raw
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    setInputValue('');
    setMenuType('none');

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    for (const line of lines) {
      // Skip @ file markers — they are labels, not commands
      if (line.startsWith('@')) {
        addConsoleLine(`> ${line}`, 'input');
        continue;
      }

      addConsoleLine(`> ${line}`, 'input');

      try {
        const response = await executeCommand(line);
        if (response) {
          addConsoleLine(response, 'output');
        }
      } catch (error) {
        addConsoleLine(
          error instanceof Error ? error.message : String(error),
          'output',
        );
      }
    }
  };

  const executeCommand = async (command: string): Promise<string> => {
    if (command === '/help') {
      return 'Commands: /apdu <hex> | /reset | /help /clear /version /status';
    }
    if (command === '/clear') {
      setConsoleLines([]);
      return 'Console cleared';
    }
    if (command === '/version') {
      return 'SmartCard Console v1.0.0';
    }
    if (command === '/status') {
      return `Active reader: ${activeReaderId ?? '(none)'} | Readers: ${readers.length}`;
    }
    if (command === '/reset') {
      return resetCardCommand();
    }

    const apduHex = command.startsWith('/apdu')
      ? command.slice('/apdu'.length).trim()
      : command;
    if (/^[0-9a-fA-F\s]+$/.test(apduHex)) {
      return sendApduCommand(apduHex);
    }
    return `Unknown command: ${command}. Type /help for available commands.`;
  };

  const resetCardCommand = async (): Promise<string> => {
    if (!activeReaderId) {
      return 'No active reader. Connect a reader first.';
    }
    await resetCard();
    // The reset operation is rendered from the /smartcard/events stream.
    return '';
  };

  const sendApduCommand = async (hex: string): Promise<string> => {
    if (!activeReaderId) {
      return 'No active reader. Connect a reader first.';
    }
    const cleaned = hex.replace(/\s+/g, '');
    if (cleaned.length < 4 || cleaned.length % 2 !== 0) {
      return 'APDU must be a valid hex string (at least 4 bytes, even length).';
    }
    await sendApdu({ hex: cleaned });
    // The APDU exchange is rendered from the /smartcard/events stream.
    return '';
  };

  const handleAddMenuItemClick = (action: string) => {
    setInputValue(`/${action} `);
    setShowAddMenu(false);
    textareaRef.current?.focus();
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;

      // Close slash/at menu when clicking outside the menu
      if (menuRef.current && !menuRef.current.contains(target)) {
        setMenuType('none');
      }

      // Close add menu when clicking outside the menu
      if (addMenuRef.current && !addMenuRef.current.contains(target)) {
        setShowAddMenu(false);
      }

      // Close reader menu when clicking outside the menu
      if (readerMenuRef.current && !readerMenuRef.current.contains(target)) {
        setShowReaderMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div
      className={[styles.panel, className].filter(Boolean).join(' ')}
      style={{ '--smartcard-panel-width': `${width}px` } as React.CSSProperties}
    >
      {/* Resize Handle */}
      <div
        className={styles.resizeHandle}
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={width}
        onPointerDown={onResizeStart}
      >
        <GripVertical className={styles.resizeIcon} />
      </div>

      {/* Header */}
      <div className={styles.header}>
        <div className={styles.title}>SmartCard Console</div>
        <button
          className={styles.toggleWidthButton}
          onClick={handleWidthToggle}
          title={width < 800 ? 'Expand console' : 'Collapse console'}
        >
          {width < 800 ? (
            <ChevronRightIcon className={styles.toggleWidthIcon} />
          ) : (
            <ChevronLeft className={styles.toggleWidthIcon} />
          )}
        </button>
      </div>

      {/* Content */}
      <div className={styles.content}>
        {/* Console Area - with border */}
        <div className={styles.consoleArea}>
          {consoleLines.map((line, index) => (
            <div
              key={index}
              className={[
                styles.consoleLine,
                line.type === 'input' ? styles.consoleInput : undefined,
                line.type === 'output'
                  ? line.message.startsWith('<')
                    ? styles.consoleOutput
                    : styles.consoleOutputMuted
                  : undefined,
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <span className={styles.timestamp}>{line.timestamp}</span>
              <span className={styles.message}>{line.message}</span>
            </div>
          ))}
          <div ref={consoleEndRef} />
        </div>

        {/* Composer - with border */}
        <div className={styles.composer} ref={composerRef}>
          {/* Slash Menu */}
          {menuType !== 'none' && currentMenuItems.length > 0 && (
            <div className={styles.menu} ref={menuRef}>
              <div className={styles.menuHeader}>
                <Slash className={styles.menuHeaderIcon} />
                <span>Commands</span>
              </div>
              <div className={styles.menuItems}>
                {currentMenuItems.map((item, index) => (
                  <>
                    {index === 1 && menuType === 'slash' && (
                      <div key="separator" className={styles.menuSeparator} />
                    )}
                    <button
                      key={item.name}
                      className={[
                        styles.menuItem,
                        index === menuIndex ? styles.menuItemActive : undefined,
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => insertMenuItem(item)}
                    >
                      <span className={styles.menuItemIcon}>
                        {(item as (typeof SLASH_COMMANDS)[0]).icon}
                      </span>
                      <span className={styles.menuItemName}>
                        /{(item as (typeof SLASH_COMMANDS)[0]).name}
                      </span>
                      <span className={styles.menuItemDesc}>
                        {(item as (typeof SLASH_COMMANDS)[0]).description}
                      </span>
                    </button>
                  </>
                ))}
              </div>
              <div className={styles.menuFooter}>
                <span>↑↓ 导航</span>
                <span>Enter 选择</span>
                <span>Esc 关闭</span>
              </div>
            </div>
          )}

          {/* Editor Area */}
          <div className={styles.editorArea}>
            {!inputValue && (
              <div className={styles.placeholder}>
                直接发送指令，内容不进入任务上下文
                <br />/ 选择快捷指令 @ 选择文件
              </div>
            )}
            <textarea
              ref={textareaRef}
              className={styles.textarea}
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              rows={2}
            />
            <input
              ref={fileInputRef}
              type="file"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
          </div>

          {/* Toolbar */}
          <div className={styles.toolbar}>
            <div className={styles.toolbarLeft}>
              <div className={styles.addMenuWrapper}>
                <button
                  className={styles.addButton}
                  onClick={() => setShowAddMenu(!showAddMenu)}
                  title="Add item"
                >
                  <Plus className={styles.addButtonIcon} />
                </button>
                {showAddMenu && (
                  <div className={styles.addMenu} ref={addMenuRef}>
                    <div className={styles.addMenuTitle}>Quick Actions</div>
                    {SLASH_COMMANDS.map((cmd) => (
                      <button
                        key={cmd.name}
                        className={styles.addMenuItem}
                        onClick={() => handleAddMenuItemClick(cmd.name)}
                      >
                        <span className={styles.addMenuItemName}>
                          /{cmd.name}
                        </span>
                        <ChevronRight className={styles.addMenuItemChevron} />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Reader Selector */}
              <div className={styles.readerMenuWrapper} ref={readerMenuRef}>
                <button
                  className={styles.readerButton}
                  onClick={() => setShowReaderMenu(!showReaderMenu)}
                  title="Select reader"
                >
                  <Usb className={styles.readerIcon} />
                  <span className={styles.readerName}>
                    {selectedReader?.name ?? 'No reader'}
                  </span>
                  <ChevronDown className={styles.readerChevron} />
                </button>
                <button
                  className={styles.connectButton}
                  onClick={handleConnectToggle}
                  disabled={!selectedReader || connecting}
                  title={
                    isSelectedConnected ? 'Disconnect reader' : 'Connect reader'
                  }
                >
                  {isSelectedConnected ? (
                    <Unplug className={styles.connectButtonIcon} />
                  ) : (
                    <Plug className={styles.connectButtonIcon} />
                  )}
                </button>
                {showReaderMenu && (
                  <div className={styles.readerMenu}>
                    <div className={styles.readerMenuTitle}>Select Reader</div>
                    {readers.length === 0 ? (
                      <div className={styles.readerMenuEmpty}>
                        No readers detected
                      </div>
                    ) : (
                      readers.map((reader) => (
                        <button
                          key={reader.id}
                          className={[
                            styles.readerMenuItem,
                            selectedReader?.id === reader.id
                              ? styles.readerMenuItemActive
                              : undefined,
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onClick={() => {
                            setSelectedReader(reader);
                            setShowReaderMenu(false);
                          }}
                        >
                          <Usb className={styles.readerMenuItemIcon} />
                          <span className={styles.readerMenuItemName}>
                            {reader.name}
                          </span>
                          <span
                            className={[
                              styles.readerMenuItemStatus,
                              reader.id === activeReaderId
                                ? styles.statusConnected
                                : styles.statusDisconnected,
                            ]
                              .filter(Boolean)
                              .join(' ')}
                          >
                            {reader.id === activeReaderId
                              ? 'connected'
                              : reader.cardPresent
                                ? 'present'
                                : 'disconnected'}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className={styles.toolbarRight}>
              <button
                className={styles.sendButton}
                onClick={handleSubmit}
                disabled={!inputValue.trim()}
              >
                <Send className={styles.sendButtonIcon} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
