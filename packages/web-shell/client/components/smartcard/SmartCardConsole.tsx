import {
  GripVertical,
  Send,
  Plus,
  Slash,
  AtSign,
  ChevronRight,
  ChevronDown,
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

// Mock data for slash commands
const SLASH_COMMANDS = [
  {
    name: 'select',
    description: 'Select a card from the workspace',
    icon: '📋',
  },
  { name: 'create', description: 'Create a new card', icon: '✨' },
  { name: 'edit', description: 'Edit an existing card', icon: '✏️' },
  { name: 'delete', description: 'Delete a card', icon: '🗑️' },
  { name: 'list', description: 'List all cards', icon: '📄' },
  { name: 'search', description: 'Search for cards', icon: '🔍' },
  { name: 'move', description: 'Move a card to another location', icon: '📦' },
  { name: 'copy', description: 'Copy a card', icon: '📋' },
];

// Mock data for @ mentions
const MENTIONS = [
  { name: 'Card-A1', type: 'card', icon: '🃏' },
  { name: 'Card-B2', type: 'card', icon: '🃏' },
  { name: 'Card-C3', type: 'card', icon: '🃏' },
  { name: 'User-John', type: 'user', icon: '👤' },
  { name: 'User-Jane', type: 'user', icon: '👤' },
  { name: 'Workspace-Main', type: 'workspace', icon: '🏢' },
];

// Mock data for + menu
const ADD_MENU_ITEMS = [
  {
    name: 'Select Card',
    description: 'Select a card from workspace',
    action: 'select',
  },
  { name: 'Create Card', description: 'Create a new card', action: 'create' },
  { name: 'Upload File', description: 'Upload a file', action: 'upload' },
  { name: 'Attach Image', description: 'Attach an image', action: 'image' },
];

/** Render a smart-card operation into a console line. */
function formatOperation(op: SmartCardOperation): string {
  switch (op.type) {
    case 'apdu': {
      const sw = op.sw.toString(16).padStart(4, '0').toUpperCase();
      return op.response ? `< ${op.response.toUpperCase()} ${sw}` : `< ${sw}`;
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
}

type MenuType = 'none' | 'slash' | 'at';

export function SmartCardConsole({
  className,
  width,
  onResizeStart,
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

  const addConsoleLine = useCallback(
    (message: string, type?: 'input' | 'output') => {
      const now = new Date();
      const timestamp = `[${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}]`;
      setConsoleLines((prev) => [...prev, { timestamp, message, type }]);
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

  // Filter items based on query
  const filteredSlashCommands = SLASH_COMMANDS.filter((cmd) =>
    cmd.name.toLowerCase().includes(menuQuery.toLowerCase()),
  );
  const filteredMentions = MENTIONS.filter((m) =>
    m.name.toLowerCase().includes(menuQuery.toLowerCase()),
  );

  const currentMenuItems =
    menuType === 'slash'
      ? filteredSlashCommands
      : menuType === 'at'
        ? filteredMentions
        : [];

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
        setMenuType('at');
        setMenuQuery(afterAt);
        setMenuIndex(0);
      } else {
        setMenuType('none');
      }
    } else {
      setMenuType('none');
    }
  };

  // Insert menu item
  const insertMenuItem = useCallback(
    (item: (typeof currentMenuItems)[0]) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const cursorPos = textarea.selectionStart;
      const textBeforeCursor = inputValue.substring(0, cursorPos);
      const textAfterCursor = inputValue.substring(cursorPos);

      let insertText = '';
      let replaceFrom = cursorPos;

      if (menuType === 'slash') {
        const lastSlash = textBeforeCursor.lastIndexOf('/');
        replaceFrom = lastSlash;
        insertText = `/${item.name} `;
      } else if (menuType === 'at') {
        const lastAt = textBeforeCursor.lastIndexOf('@');
        replaceFrom = lastAt;
        insertText = `@${item.name} `;
      }

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
    [inputValue, menuType],
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

  // Handle submit
  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const raw = inputValue.trim();
    if (!raw) return;

    addConsoleLine(`> ${raw}`, 'input');

    try {
      const response = await executeCommand(raw);
      if (response) {
        addConsoleLine(response, 'output');
      }
    } catch (error) {
      addConsoleLine(
        error instanceof Error ? error.message : String(error),
        'output',
      );
    }

    setInputValue('');
    setMenuType('none');

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    setTimeout(() => {
      consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 0);
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
    if (cleaned.length < 8 || cleaned.length % 2 !== 0) {
      return 'APDU must be a hex string of at least 4 bytes.';
    }
    const bytes = new Uint8Array(cleaned.length / 2);
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Number.parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
    }
    const [cla, ins, p1, p2] = bytes;
    let data: string | undefined;
    if (bytes.length > 4) {
      data = Array.from(bytes.slice(4), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('');
    }
    await sendApdu({ cla, ins, p1, p2, data });
    // The APDU exchange is rendered from the /smartcard/events stream.
    return '';
  };

  const handleAddMenuItemClick = (item: (typeof ADD_MENU_ITEMS)[0]) => {
    setInputValue(`/${item.action} `);
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
                line.type === 'output' ? styles.consoleOutput : undefined,
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
          {/* Slash/At Menu */}
          {menuType !== 'none' && currentMenuItems.length > 0 && (
            <div className={styles.menu} ref={menuRef}>
              <div className={styles.menuHeader}>
                {menuType === 'slash' ? (
                  <>
                    <Slash className={styles.menuHeaderIcon} />
                    <span>Commands</span>
                  </>
                ) : (
                  <>
                    <AtSign className={styles.menuHeaderIcon} />
                    <span>Mentions</span>
                  </>
                )}
              </div>
              <div className={styles.menuItems}>
                {currentMenuItems.map((item, index) => (
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
                    {menuType === 'slash' ? (
                      <>
                        <span className={styles.menuItemIcon}>
                          {(item as (typeof SLASH_COMMANDS)[0]).icon}
                        </span>
                        <span className={styles.menuItemName}>
                          /{(item as (typeof SLASH_COMMANDS)[0]).name}
                        </span>
                        <span className={styles.menuItemDesc}>
                          {(item as (typeof SLASH_COMMANDS)[0]).description}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className={styles.menuItemIcon}>
                          {(item as (typeof MENTIONS)[0]).icon}
                        </span>
                        <span className={styles.menuItemName}>
                          @{(item as (typeof MENTIONS)[0]).name}
                        </span>
                        <span className={styles.menuItemType}>
                          {(item as (typeof MENTIONS)[0]).type}
                        </span>
                      </>
                    )}
                  </button>
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
                <br />/ 选择快捷指令 @ 指定脚本文件
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
                    {ADD_MENU_ITEMS.map((item) => (
                      <button
                        key={item.action}
                        className={styles.addMenuItem}
                        onClick={() => handleAddMenuItemClick(item)}
                      >
                        <span className={styles.addMenuItemName}>
                          {item.name}
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
