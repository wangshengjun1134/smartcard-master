import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import styles from './KnowledgePage.module.css';

/**
 * KnowledgePage - 智能卡知识图谱页面
 *
 * 三栏工作区（领域导航 / 力导向画布 / 节点详情），基于 d3-force 渲染。
 * 支持搜索定位、领域过滤、节点拖拽、滚轮缩放、悬停高亮与关联节点跳转。
 */
type Category = 'standard' | 'telecom' | 'security' | 'application' | 'device';

const PALETTE: Record<Category, string> = {
  standard: '#4a6fa5',
  telecom: '#8a7ca8',
  security: '#7ba38c',
  application: '#c49a6c',
  device: '#b3594a',
};

const CATEGORY_NAMES: Record<Category, string> = {
  standard: '标准 / 接口',
  telecom: '移动通信',
  security: '安全 / 平台',
  application: '行业应用',
  device: '设备 / 终端',
};

const CATEGORY_ORDER: Category[] = [
  'standard',
  'telecom',
  'security',
  'application',
  'device',
];

const CATEGORY_RADIUS: Record<Category, number> = {
  standard: 255,
  telecom: 245,
  security: 230,
  application: 235,
  device: 250,
};

const CATEGORY_ANGLE: Record<Category, number> = {
  standard: -1.58,
  telecom: -2.75,
  security: -0.35,
  application: 0.62,
  device: 2.55,
};

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  name: string;
  cat: Category;
  desc: string;
  core?: boolean;
  hub?: boolean;
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
  type: 'normal' | 'strong';
  strength: number;
}

const HUBS: GraphNode[] = [
  {
    id: 'h-standard',
    name: '标准与接口',
    cat: 'standard',
    hub: true,
    desc: '卡片、射频、传输与终端接口规范',
  },
  {
    id: 'h-telecom',
    name: '移动通信',
    cat: 'telecom',
    hub: true,
    desc: 'SIM / USIM / eSIM / IoT 标准体系',
  },
  {
    id: 'h-security',
    name: '安全与平台',
    cat: 'security',
    hub: true,
    desc: '卡片安全机制、平台与认证',
  },
  {
    id: 'h-application',
    name: '行业应用',
    cat: 'application',
    hub: true,
    desc: '支付、交通、证照等业务规范',
  },
  {
    id: 'h-device',
    name: '设备与终端',
    cat: 'device',
    hub: true,
    desc: '读卡器、手机、穿戴与 IoT 设备',
  },
];

const LEAVES: GraphNode[] = [
  {
    id: 'iso7816',
    name: 'ISO/IEC 7816',
    cat: 'standard',
    desc: '接触式智能卡基础标准',
  },
  {
    id: 'iso14443',
    name: 'ISO/IEC 14443',
    cat: 'standard',
    desc: '非接触式卡片与近场通信',
  },
  {
    id: 'iso15693',
    name: 'ISO/IEC 15693',
    cat: 'standard',
    desc: '邻近式卡片接口',
  },
  {
    id: 'pcsc',
    name: 'PC/SC 规范',
    cat: 'standard',
    desc: 'PC/SC 智能卡接口规范',
  },
  {
    id: 'usbccid',
    name: 'USB CCID',
    cat: 'device',
    desc: 'USB 智能卡接口设备类',
  },
  {
    id: 'r7816-3',
    name: '7816-3 传输协议',
    cat: 'standard',
    desc: '接触式卡片电气与传输协议',
  },
  {
    id: 'r7816-4',
    name: '7816-4 APDU 命令',
    cat: 'standard',
    desc: '应用协议数据单元',
  },
  {
    id: 'r7816-8',
    name: '7816-8 安全机制',
    cat: 'standard',
    desc: '与安全相关的命令与机制',
  },
  {
    id: 'r14443-3',
    name: '14443-3 防冲突',
    cat: 'standard',
    desc: '非接触式卡防冲突与初始化',
  },
  { id: 'nfc', name: 'NFC Forum', cat: 'standard', desc: 'NFC 产业生态规范' },

  {
    id: 'gsm',
    name: 'GSM / SGP.x',
    cat: 'telecom',
    desc: 'SIM / eSIM 相关规范族',
  },
  {
    id: '3gpp',
    name: '3GPP TS 31.x',
    cat: 'telecom',
    desc: 'USIM / UICC 应用与接口',
  },
  {
    id: 'sgp22',
    name: 'SGP.22 Consumer',
    cat: 'telecom',
    desc: '消费类 eSIM 远程配置',
  },
  {
    id: 'sgp32',
    name: 'SGP.32 IoT',
    cat: 'telecom',
    desc: 'IoT eSIM 远程配置',
  },
  {
    id: 'tca',
    name: 'TCA Profile 规范',
    cat: 'telecom',
    desc: 'eSIM / eUICC profile 相关规范',
  },
  {
    id: 'ts31101',
    name: 'TS 31.101 终端接口',
    cat: 'telecom',
    desc: 'UICC 通用终端接口',
  },
  { id: 'ts31121', name: 'TS 31.121', cat: 'telecom', desc: 'UICC 测试规范' },
  {
    id: 'sgp02m2m',
    name: 'SGP.02 M2M',
    cat: 'telecom',
    desc: 'M2M eSIM 远程配置',
  },

  {
    id: 'gp',
    name: 'GlobalPlatform',
    cat: 'security',
    desc: '智能卡应用生命周期与安全域',
  },
  { id: 'scp', name: 'SCP02/03/11', cat: 'security', desc: '安全通道协议' },
  { id: 'omapi', name: 'OMAPI', cat: 'security', desc: 'Open Mobile API' },
  { id: 'fido2', name: 'FIDO2', cat: 'security', desc: '身份认证协议与凭据' },
  {
    id: 'cc',
    name: 'Common Criteria',
    cat: 'security',
    desc: '信息安全产品通用评估准则',
  },
  {
    id: 'eal',
    name: 'EAL4+ / EAL5+',
    cat: 'security',
    desc: '安全评估保障等级',
  },
  {
    id: 'javacard',
    name: 'Java Card',
    cat: 'security',
    desc: '智能卡虚拟机与应用平台',
  },

  {
    id: 'pboc',
    name: 'PBOC 3.0',
    cat: 'application',
    desc: '银行卡/支付应用规范',
  },
  {
    id: 'emv',
    name: 'EMV 支付',
    cat: 'application',
    desc: '银行卡支付技术体系',
  },
  {
    id: 'calypso',
    name: 'Calypso 交通',
    cat: 'application',
    desc: '公共交通票务卡体系',
  },
  {
    id: 'ica0',
    name: 'ICAO 9303 电子护照',
    cat: 'application',
    desc: '机器可读旅行证件',
  },

  {
    id: 'wearable',
    name: '可穿戴设备',
    cat: 'device',
    desc: '穿戴式智能卡终端',
  },
  {
    id: 'reader',
    name: '读卡器 / IFD',
    cat: 'device',
    desc: 'PC/SC 读卡器与接口设备',
  },
  {
    id: 'phone',
    name: '手机 / 移动终端',
    cat: 'device',
    desc: '支持 UICC / NFC / eSE 的终端',
  },
  {
    id: 'iotdevice',
    name: 'IoT 设备',
    cat: 'device',
    desc: '面向 IoT 场景的安全器件与终端',
  },
  { id: 'pos', name: 'POS / 支付终端', cat: 'device', desc: '支付受理终端' },
];

const NODES: GraphNode[] = [
  {
    id: 'core',
    name: '智能卡规范体系',
    cat: 'standard',
    core: true,
    desc: 'Smart Card standards ecosystem',
  },
  ...HUBS,
  ...LEAVES,
];

const LINKS: GraphLink[] = (() => {
  const links: GraphLink[] = [];
  const add = (
    source: string,
    target: string,
    type: 'normal' | 'strong' = 'normal',
    strength = 1,
  ) => {
    links.push({ source, target, type, strength });
  };

  HUBS.forEach((hub) => add('core', hub.id, 'strong', 3));

  [
    'iso7816',
    'iso14443',
    'iso15693',
    'pcsc',
    'r7816-3',
    'r7816-4',
    'r7816-8',
    'r14443-3',
    'nfc',
  ].forEach((id) => add('h-standard', id, 'normal', 2));
  add('iso7816', 'r7816-3', 'strong', 3);
  add('iso7816', 'r7816-4', 'strong', 3);
  add('iso7816', 'r7816-8', 'strong', 2);
  add('iso14443', 'r14443-3', 'strong', 3);
  add('iso14443', 'nfc');
  add('pcsc', 'reader', 'strong');
  add('usbccid', 'reader', 'strong');
  add('iso7816', 'reader');
  add('iso14443', 'phone');

  [
    'gsm',
    '3gpp',
    'sgp22',
    'sgp32',
    'tca',
    'ts31101',
    'ts31121',
    'sgp02m2m',
  ].forEach((id) => add('h-telecom', id, 'normal', 2));
  add('3gpp', 'gsm', 'strong', 2);
  add('sgp22', 'tca');
  add('sgp32', 'tca');
  add('sgp02m2m', 'tca');
  add('ts31101', '3gpp', 'strong');
  add('ts31121', 'ts31101');
  add('gsm', 'phone');
  add('sgp32', 'iotdevice', 'strong');

  ['gp', 'scp', 'omapi', 'fido2', 'cc', 'eal', 'javacard'].forEach((id) =>
    add('h-security', id, 'normal', 2),
  );
  add('gp', 'scp', 'strong', 3);
  add('gp', 'javacard', 'strong');
  add('scp', 'r7816-4', 'strong');
  add('omapi', 'phone');
  add('cc', 'eal', 'strong');
  add('fido2', 'javacard');
  add('gp', 'core');

  ['pboc', 'emv', 'calypso', 'ica0'].forEach((id) =>
    add('h-application', id, 'normal', 2),
  );
  add('pboc', 'emv', 'strong');
  add('emv', 'pos', 'strong');
  add('calypso', 'iso14443', 'strong');
  add('ica0', 'iso7816', 'strong');

  ['reader', 'usbccid', 'phone', 'wearable', 'iotdevice', 'pos'].forEach((id) =>
    add('h-device', id, 'normal', 2),
  );
  add('wearable', 'iso14443');
  add('wearable', 'nfc');
  add('pos', 'pcsc');
  add('phone', 'nfc');
  add('iotdevice', 'sgp32');

  add('pcsc', 'r7816-4', 'strong');
  add('iso14443', 'gp');

  return links;
})();

const NODE_BY_ID = new Map(NODES.map((node) => [node.id, node]));

function colorOf(node: GraphNode): string {
  return PALETTE[node.cat];
}

function borderOf(node: GraphNode): string {
  const base = d3.color(colorOf(node));
  return base ? base.darker(0.8).formatHex() : '#ffffff';
}

function idOf(end: string | GraphNode): string {
  return typeof end === 'string' ? end : end.id;
}

function nodeOf(end: string | GraphNode): GraphNode {
  if (typeof end !== 'string') return end;
  return NODE_BY_ID.get(end) ?? NODES[0];
}

function radiusOf(node: GraphNode): number {
  if (node.core) return 30;
  if (node.hub) return 17;
  return 8;
}

function chargeOf(node: GraphNode): number {
  if (node.core) return -520;
  if (node.hub) return -210;
  return -85;
}

function collideOf(node: GraphNode): number {
  if (node.core) return 54;
  if (node.hub) return 28;
  return 22;
}

function linkClass(link: GraphLink): string {
  return link.type === 'strong'
    ? `${styles.link} ${styles.strong}`
    : styles.link;
}

function labelClass(node: GraphNode): string {
  if (node.core) return `${styles.label} ${styles.center}`;
  if (node.hub) return `${styles.label} ${styles.hub}`;
  return styles.label;
}

function nodeTypeLabel(node: GraphNode): string {
  if (node.core) return '主中心';
  if (node.hub) return '领域 Hub';
  return '知识节点';
}

function countLeavesOf(category: Category): number {
  return LEAVES.filter((node) => node.cat === category).length;
}

function curvePath(link: GraphLink): string {
  const source = nodeOf(link.source);
  const target = nodeOf(link.target);
  const sx = source.x ?? 0;
  const sy = source.y ?? 0;
  const tx = target.x ?? 0;
  const ty = target.y ?? 0;
  const mx = (sx + tx) / 2;
  const my = (sy + ty) / 2;
  const dx = tx - sx;
  const dy = ty - sy;
  const length = Math.hypot(dx, dy) || 1;
  const bend = (link.type === 'strong' ? 0.05 : 0.15) * Math.min(90, length);
  const nx = -dy / length;
  const ny = dx / length;
  return `M${sx},${sy} Q ${mx + nx * bend},${my + ny * bend} ${tx},${ty}`;
}

export const KnowledgePage = memo(function KnowledgePage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const rootRef = useRef<d3.Selection<
    SVGGElement,
    unknown,
    null,
    undefined
  > | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const nodeSelRef = useRef<d3.Selection<
    SVGGElement,
    GraphNode,
    SVGGElement,
    unknown
  > | null>(null);
  const linkSelRef = useRef<d3.Selection<
    SVGPathElement,
    GraphLink,
    SVGGElement,
    unknown
  > | null>(null);
  const sizeRef = useRef({ width: 900, height: 650 });
  const centerRef = useRef({ cx: 450, cy: 333 });
  const enabledRef = useRef<Set<Category>>(new Set(CATEGORY_ORDER));
  const queryRef = useRef('');

  const [selectedId, setSelectedId] = useState('core');
  const [enabled, setEnabled] = useState<Set<Category>>(
    () => new Set(CATEGORY_ORDER),
  );
  const [query, setQuery] = useState('');

  const applyFilters = useCallback(() => {
    const node = nodeSelRef.current;
    const link = linkSelRef.current;
    if (!node || !link) return;
    const needle = queryRef.current.trim().toLowerCase();
    const isVisible = (datum: GraphNode): boolean => {
      if (!enabledRef.current.has(datum.cat)) return false;
      if (!needle) return true;
      return (
        datum.name.toLowerCase().includes(needle) ||
        datum.desc.toLowerCase().includes(needle)
      );
    };
    node.classed(styles.dim, (datum) => !isVisible(datum));
    link.classed(
      styles.dim,
      (datum) =>
        !isVisible(nodeOf(datum.source)) || !isVisible(nodeOf(datum.target)),
    );
  }, []);

  const handleHover = useCallback(
    (focus: GraphNode | null) => {
      const node = nodeSelRef.current;
      const link = linkSelRef.current;
      if (!node || !link) return;
      if (!focus) {
        applyFilters();
        return;
      }
      const related = new Set<string>([focus.id]);
      LINKS.forEach((linkDatum) => {
        const source = idOf(linkDatum.source);
        const target = idOf(linkDatum.target);
        if (source === focus.id) related.add(target);
        if (target === focus.id) related.add(source);
      });
      node.classed(styles.dim, (datum) => !related.has(datum.id));
      link.classed(
        styles.dim,
        (datum) =>
          !related.has(idOf(datum.source)) || !related.has(idOf(datum.target)),
      );
    },
    [applyFilters],
  );

  const fit = useCallback(() => {
    const svgEl = svgRef.current;
    const zoom = zoomRef.current;
    if (!svgEl || !zoom) return;
    const { width, height } = sizeRef.current;
    const xs = NODES.map((node) => node.x ?? 0);
    const ys = NODES.map((node) => node.y ?? 0);
    const minX = Math.min(...xs) - 70;
    const maxX = Math.max(...xs) + 70;
    const minY = Math.min(...ys) - 55;
    const maxY = Math.max(...ys) + 55;
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    const scale = Math.min(width / spanX, height / spanY) * 0.9;
    const tx = width / 2 - ((minX + maxX) / 2) * scale;
    const ty = height / 2 - ((minY + maxY) / 2) * scale;
    d3.select(svgEl)
      .transition()
      .duration(450)
      .call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
  }, []);

  const zoomBy = useCallback((factor: number) => {
    const svgEl = svgRef.current;
    const zoom = zoomRef.current;
    if (!svgEl || !zoom) return;
    d3.select(svgEl).transition().call(zoom.scaleBy, factor);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    const svgEl = svgRef.current;
    if (!container || !svgEl) return;

    const svg = d3.select(svgEl);
    const root = svg.append('g');
    rootRef.current = root;
    const orbitLayer = root.append('g');
    const linkLayer = root.append('g');
    const nodeLayer = root.append('g');

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.45, 2.6])
      .on('zoom', (event) => {
        root.attr('transform', event.transform.toString());
      });
    zoomRef.current = zoom;
    svg.call(zoom);
    svg.on('dblclick.zoom', null);

    const applySize = () => {
      const width = container.clientWidth || 900;
      const height = container.clientHeight || 650;
      sizeRef.current = { width, height };
      centerRef.current = { cx: width / 2, cy: height / 2 + 8 };
      svg.attr('viewBox', `0 0 ${width} ${height}`);
    };
    applySize();

    const drawOrbits = () => {
      const { cx, cy } = centerRef.current;
      orbitLayer.selectAll('*').remove();
      orbitLayer
        .append('circle')
        .attr('class', styles.centerRing)
        .attr('cx', cx)
        .attr('cy', cy)
        .attr('r', 62);
      orbitLayer
        .append('circle')
        .attr('class', styles.centerOrbit)
        .attr('cx', cx)
        .attr('cy', cy)
        .attr('r', 145);
      orbitLayer
        .append('circle')
        .attr('class', styles.centerOrbit)
        .attr('cx', cx)
        .attr('cy', cy)
        .attr('r', 255);
    };
    drawOrbits();

    const { cx, cy } = centerRef.current;
    NODES.forEach((node) => {
      if (node.core) {
        node.x = cx;
        node.y = cy;
        node.fx = cx;
        node.fy = cy;
      } else if (node.hub) {
        const angle = CATEGORY_ANGLE[node.cat];
        node.x = cx + Math.cos(angle) * 145;
        node.y = cy + Math.sin(angle) * 145;
        node.fx = node.x;
        node.fy = node.y;
      }
    });

    const leavesByCategory = new Map<Category, GraphNode[]>();
    NODES.filter((node) => !node.core && !node.hub).forEach((node) => {
      const list = leavesByCategory.get(node.cat) ?? [];
      list.push(node);
      leavesByCategory.set(node.cat, list);
    });
    leavesByCategory.forEach((list, category) => {
      const start = CATEGORY_ANGLE[category];
      const radius = CATEGORY_RADIUS[category];
      const span = Math.min(1, Math.max(0.55, list.length * 0.09));
      list.forEach((node, index) => {
        const t = list.length === 1 ? 0.5 : index / (list.length - 1);
        const angle = start - span / 2 + t * span;
        node.x = cx + Math.cos(angle) * radius;
        node.y = cy + Math.sin(angle) * radius;
      });
    });

    const simulation = d3
      .forceSimulation<GraphNode, GraphLink>(NODES)
      .force(
        'link',
        d3
          .forceLink<GraphNode, GraphLink>(LINKS)
          .id((node) => node.id)
          .distance((link) => (link.type === 'strong' ? 92 : 72))
          .strength((link) => (link.strength ? 0.14 : 0.08)),
      )
      .force(
        'charge',
        d3.forceManyBody<GraphNode>().strength((node) => chargeOf(node)),
      )
      .force(
        'collide',
        d3
          .forceCollide<GraphNode>()
          .radius((node) => collideOf(node))
          .strength(0.9),
      )
      .force(
        'x',
        d3
          .forceX<GraphNode>((node) =>
            node.core ? centerRef.current.cx : (node.x ?? 0),
          )
          .strength((node) => (node.core ? 1 : 0.03)),
      )
      .force(
        'y',
        d3
          .forceY<GraphNode>((node) =>
            node.core ? centerRef.current.cy : (node.y ?? 0),
          )
          .strength((node) => (node.core ? 1 : 0.03)),
      )
      .alpha(0.75)
      .alphaDecay(0.035);

    const link = linkLayer
      .selectAll<SVGPathElement, GraphLink>('path')
      .data(LINKS)
      .join('path')
      .attr('class', (datum) => linkClass(datum));
    linkSelRef.current = link;

    const drag = d3
      .drag<SVGGElement, GraphNode>()
      .on('start', (event, datum) => {
        if (!event.active) simulation.alphaTarget(0.2).restart();
        datum.fx = datum.x ?? null;
        datum.fy = datum.y ?? null;
      })
      .on('drag', (event, datum) => {
        datum.fx = event.x;
        datum.fy = event.y;
      })
      .on('end', (event, datum) => {
        if (!event.active) simulation.alphaTarget(0);
        if (!datum.core && !datum.hub) {
          datum.fx = null;
          datum.fy = null;
        }
      });

    const node = nodeLayer
      .selectAll<SVGGElement, GraphNode>('g')
      .data(NODES)
      .join('g')
      .attr('class', styles.node)
      .call(drag);
    nodeSelRef.current = node;

    node
      .append('circle')
      .attr('class', styles.nodeDot)
      .attr('r', (datum) => radiusOf(datum))
      .attr('fill', (datum) => colorOf(datum))
      .attr('stroke', (datum) => borderOf(datum));

    node
      .filter((datum) => Boolean(datum.core))
      .append('circle')
      .attr('class', styles.coreRing)
      .attr('r', 46)
      .attr('fill', 'none');

    const labels = node
      .append('text')
      .attr('class', (datum) => labelClass(datum))
      .text((datum) => datum.name);

    const positionLabels = () => {
      const centerX = centerRef.current.cx;
      labels
        .attr('x', (datum) =>
          datum.core ? 0 : (datum.x ?? 0) < centerX ? -14 : 14,
        )
        .attr('text-anchor', (datum) => {
          if (datum.core) return 'middle';
          return (datum.x ?? 0) < centerX ? 'end' : 'start';
        })
        .attr('dy', (datum) => (datum.core || datum.hub ? 0 : 1));
    };

    simulation.on('tick', () => {
      link.attr('d', (datum) => curvePath(datum));
      node.attr(
        'transform',
        (datum) => `translate(${datum.x ?? 0},${datum.y ?? 0})`,
      );
      positionLabels();
    });

    node.on('click', (_event, datum) => setSelectedId(datum.id));
    node.on('mouseenter', (_event, datum) => handleHover(datum));
    node.on('mouseleave', () => handleHover(null));

    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      if (resizeTimer !== undefined) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const width = container.clientWidth || 900;
        const height = container.clientHeight || 650;
        // ResizeObserver fires once on observe(); ignore the no-op initial call
        // so the first fit() frames the pre-simulation positions.
        if (
          width === sizeRef.current.width &&
          height === sizeRef.current.height
        ) {
          return;
        }
        applySize();
        drawOrbits();
        fit();
      }, 120);
    });
    observer.observe(container);

    fit();

    return () => {
      if (resizeTimer !== undefined) clearTimeout(resizeTimer);
      observer.disconnect();
      simulation.stop();
      svg.on('.zoom', null);
      svg.selectAll('*').remove();
      rootRef.current = null;
      zoomRef.current = null;
      nodeSelRef.current = null;
      linkSelRef.current = null;
    };
  }, [applyFilters, fit, handleHover]);

  useEffect(() => {
    enabledRef.current = enabled;
    applyFilters();
  }, [enabled, applyFilters]);

  useEffect(() => {
    queryRef.current = query;
    applyFilters();
    const needle = query.trim().toLowerCase();
    if (!needle) return;
    const match = NODES.find((node) =>
      node.name.toLowerCase().includes(needle),
    );
    if (match) setSelectedId(match.id);
  }, [query, applyFilters]);

  useEffect(() => {
    const node = nodeSelRef.current;
    if (!node) return;
    node.classed(styles.focus, (datum) => datum.id === selectedId);
  }, [selectedId]);

  const toggleCategory = useCallback((category: Category) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    const all = new Set(CATEGORY_ORDER);
    enabledRef.current = all;
    queryRef.current = '';
    setEnabled(all);
    setQuery('');
    setSelectedId('core');
    nodeSelRef.current?.classed(styles.focus, (datum) => datum.id === 'core');
    applyFilters();
    fit();
  }, [applyFilters, fit]);

  const selected = NODE_BY_ID.get(selectedId) ?? NODES[0];

  const related = useMemo(() => {
    const list: GraphNode[] = [];
    LINKS.forEach((link) => {
      const source = idOf(link.source);
      const target = idOf(link.target);
      if (source === selected.id) {
        const node = NODE_BY_ID.get(target);
        if (node) list.push(node);
      } else if (target === selected.id) {
        const node = NODE_BY_ID.get(source);
        if (node) list.push(node);
      }
    });
    return list;
  }, [selected]);

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div className={styles.search}>
          <span className={styles.searchIcon} aria-hidden="true">
            ⌕
          </span>
          <input
            className={styles.searchInput}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索节点 / 标准 / 协议…"
            aria-label="搜索节点"
          />
        </div>
        <button type="button" className={styles.ghostBtn} onClick={reset}>
          重置视图
        </button>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={fit}
          title="适应窗口"
          aria-label="适应窗口"
        >
          ⌗
        </button>
      </div>

      <div className={styles.workspace}>
        <aside className={styles.left}>
          <div className={styles.sectionTitle}>领域</div>
          <div className={styles.legend} data-testid="knowledge-legend">
            {CATEGORY_ORDER.map((category) => (
              <button
                key={category}
                type="button"
                className={`${styles.legendItem} ${
                  enabled.has(category) ? styles.active : ''
                }`}
                onClick={() => toggleCategory(category)}
              >
                <span
                  className={styles.dot}
                  style={{ background: PALETTE[category] }}
                />
                <span className={styles.legendName}>
                  {CATEGORY_NAMES[category]}
                </span>
                <span className={styles.legendCount}>
                  {countLeavesOf(category)}
                </span>
              </button>
            ))}
          </div>
          <div className={styles.divider} />
          <div className={styles.sectionTitle}>图谱结构</div>
          <div className={styles.hint}>
            建议把“规范体系”作为唯一主中心，再用 5 个领域 Hub
            分组。默认只强调主干关系，减少无意义的交叉线。
          </div>
          <div className={styles.divider} />
          <div className={styles.sectionTitle}>交互</div>
          <div className={styles.hint}>
            点击节点查看详情；拖动节点可微调布局；滚轮缩放；输入搜索可快速定位节点。
          </div>
        </aside>

        <main className={styles.canvas} ref={containerRef}>
          <div className={styles.canvasGrid} />
          <div className={styles.canvasTop}>
            <div className={styles.pill}>
              {NODES.length} 个节点 · {LINKS.length} 条关系
            </div>
            <div className={styles.controls}>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => zoomBy(1.2)}
                aria-label="放大"
              >
                ＋
              </button>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => zoomBy(0.83)}
                aria-label="缩小"
              >
                －
              </button>
            </div>
          </div>
          <svg className={styles.graph} ref={svgRef} />
          <div className={styles.footerNote}>
            视觉策略：中心聚焦 + 领域分组 + 主干关系优先
          </div>
        </main>

        <aside className={styles.right}>
          <div className={styles.panelTitle}>{selected.name}</div>
          <div className={styles.panelSub}>{selected.desc}</div>
          <div className={styles.detailCard}>
            <div className={styles.meta}>
              <b>领域</b>
              <span>{CATEGORY_NAMES[selected.cat]}</span>
              <b>节点类型</b>
              <span>{nodeTypeLabel(selected)}</span>
              <b>关系数</b>
              <span>{related.length}</span>
            </div>
            <div className={styles.tagRow}>
              <span className={styles.tag}>Smart Card</span>
              <span className={styles.tag}>Knowledge Graph</span>
              <span className={styles.tag}>{selected.cat}</span>
            </div>
          </div>
          <div className={styles.sectionTitle} style={{ marginLeft: 2 }}>
            关联节点
          </div>
          <div className={styles.detailCard}>
            <div className={styles.related}>
              {related.slice(0, 10).map((node) => (
                <button
                  key={node.id}
                  type="button"
                  className={styles.relatedRow}
                  onClick={() => setSelectedId(node.id)}
                >
                  <span
                    className={styles.mini}
                    style={{ background: colorOf(node) }}
                  />
                  <span className={styles.relatedName}>{node.name}</span>
                </button>
              ))}
              {related.length === 0 && (
                <div className={styles.empty}>暂无直接关系</div>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
});
