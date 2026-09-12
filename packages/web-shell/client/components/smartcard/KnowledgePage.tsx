import { memo, useRef, useEffect, useCallback } from 'react';
import * as echarts from 'echarts';

/**
 * KnowledgePage - 智能卡知识图谱页面
 *
 * 使用 React + ECharts 力导向图展示智能卡规范体系知识图谱
 */
export const KnowledgePage = memo(function KnowledgePage() {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);

  const initChart = useCallback(() => {
    if (!chartRef.current) return;

    // 清理旧实例
    if (chartInstanceRef.current) {
      chartInstanceRef.current.dispose();
    }

    const chart = echarts.init(chartRef.current);
    chartInstanceRef.current = chart;

    // 定义节点类别（颜色区分）
    const categories = [
      { name: '基础标准', itemStyle: { color: '#4A7CEC' } }, // 蓝色 - ISO/IEC
      { name: '电信与eSIM', itemStyle: { color: '#D86ED6' } }, // 紫色 - 3GPP/GSMA
      { name: '应用管理与安全', itemStyle: { color: '#8BC34A' } }, // 绿色 - GP/Java Card/CC
      { name: '终端设备', itemStyle: { color: '#F5804A' } }, // 橙色 - 手机/读卡器/POS
      { name: '行业应用与中国标准', itemStyle: { color: '#F5C842' } }, // 黄色 - EMV/PBOC
    ];

    // 节点数据
    const nodes = [
      // 核心节点
      { name: '智能卡规范体系', symbolSize: 55, category: 0 },

      // 蓝色系 - 基础标准
      { name: 'ISO/IEC 7816', symbolSize: 40, category: 0 },
      { name: 'ISO/IEC 14443', symbolSize: 40, category: 0 },
      { name: 'ISO/IEC 15693', symbolSize: 25, category: 0 },
      { name: 'ISO/IEC 18092', symbolSize: 25, category: 0 },
      { name: '7816-3 传输协议', symbolSize: 18, category: 0 },
      { name: '7816-4 APDU命令', symbolSize: 18, category: 0 },
      { name: '7816-8 安全机制', symbolSize: 18, category: 0 },
      { name: '14443-3 防冲突', symbolSize: 18, category: 0 },
      { name: '14443-4 传输协议', symbolSize: 18, category: 0 },
      { name: 'NFC Forum', symbolSize: 20, category: 0 },

      // 紫色系 - 电信与eSIM
      { name: '3GPP TS 31.x', symbolSize: 40, category: 1 },
      { name: 'ETSI TS 102.x', symbolSize: 35, category: 1 },
      { name: 'GSMA SGP.x', symbolSize: 40, category: 1 },
      { name: 'TCA Profile规范', symbolSize: 30, category: 1 },
      { name: 'TS 31.101 终端接口', symbolSize: 18, category: 1 },
      { name: 'TS 31.102 USIM', symbolSize: 18, category: 1 },
      { name: 'TS 31.121 测试规范', symbolSize: 18, category: 1 },
      { name: 'TS 102.221 UICC接口', symbolSize: 18, category: 1 },
      { name: 'SGP.02 M2M', symbolSize: 18, category: 1 },
      { name: 'SGP.22 Consumer', symbolSize: 18, category: 1 },
      { name: 'SGP.32 IoT', symbolSize: 18, category: 1 },

      // 绿色系 - 应用管理与安全
      { name: 'GlobalPlatform', symbolSize: 40, category: 2 },
      { name: 'Java Card', symbolSize: 35, category: 2 },
      { name: 'Common Criteria', symbolSize: 35, category: 2 },
      { name: 'SCP02/03/11', symbolSize: 18, category: 2 },
      { name: 'OMAPI', symbolSize: 18, category: 2 },
      { name: 'JCAPI/JCVM', symbolSize: 18, category: 2 },
      { name: 'EAL4+/EAL5+', symbolSize: 18, category: 2 },

      // 橙色系 - 终端设备
      { name: '手机/移动终端', symbolSize: 35, category: 3 },
      { name: '读卡器/IFD', symbolSize: 35, category: 3 },
      { name: 'POS/支付终端', symbolSize: 35, category: 3 },
      { name: 'IoT设备', symbolSize: 30, category: 3 },
      { name: '可穿戴设备', symbolSize: 25, category: 3 },
      { name: 'PC/SC规范', symbolSize: 18, category: 3 },
      { name: 'USB CCID', symbolSize: 18, category: 3 },
      { name: 'PCI PTS', symbolSize: 18, category: 3 },
      { name: 'EMVCo L1/L2', symbolSize: 18, category: 3 },

      // 黄色系 - 行业应用与中国标准
      { name: 'EMV 支付', symbolSize: 35, category: 4 },
      { name: 'ICAO 9303 电子护照', symbolSize: 30, category: 4 },
      { name: 'Calypso 交通', symbolSize: 25, category: 4 },
      { name: 'FIDO2', symbolSize: 25, category: 4 },
      { name: 'PBOC 3.0', symbolSize: 30, category: 4 },
      { name: 'GB/T 16649', symbolSize: 25, category: 4 },
      { name: 'YD/T 系列', symbolSize: 25, category: 4 },
      { name: 'JR/T 0025', symbolSize: 25, category: 4 },
    ];

    // 连线数据
    const links = [
      // 核心节点连接一级节点
      { source: '智能卡规范体系', target: 'ISO/IEC 7816' },
      { source: '智能卡规范体系', target: 'ISO/IEC 14443' },
      { source: '智能卡规范体系', target: 'ISO/IEC 15693' },
      { source: '智能卡规范体系', target: 'ISO/IEC 18092' },
      { source: '智能卡规范体系', target: '3GPP TS 31.x' },
      { source: '智能卡规范体系', target: 'ETSI TS 102.x' },
      { source: '智能卡规范体系', target: 'GSMA SGP.x' },
      { source: '智能卡规范体系', target: 'GlobalPlatform' },
      { source: '智能卡规范体系', target: 'Java Card' },
      { source: '智能卡规范体系', target: 'Common Criteria' },
      { source: '智能卡规范体系', target: '手机/移动终端' },
      { source: '智能卡规范体系', target: '读卡器/IFD' },
      { source: '智能卡规范体系', target: 'POS/支付终端' },
      { source: '智能卡规范体系', target: 'IoT设备' },
      { source: '智能卡规范体系', target: 'EMV 支付' },
      { source: '智能卡规范体系', target: 'ICAO 9303 电子护照' },
      { source: '智能卡规范体系', target: 'Calypso 交通' },
      { source: '智能卡规范体系', target: 'FIDO2' },
      { source: '智能卡规范体系', target: 'PBOC 3.0' },

      // 基础标准展开
      { source: 'ISO/IEC 7816', target: '7816-3 传输协议' },
      { source: 'ISO/IEC 7816', target: '7816-4 APDU命令' },
      { source: 'ISO/IEC 7816', target: '7816-8 安全机制' },
      { source: 'ISO/IEC 14443', target: '14443-3 防冲突' },
      { source: 'ISO/IEC 14443', target: '14443-4 传输协议' },
      { source: 'ISO/IEC 14443', target: 'NFC Forum' },

      // 电信与eSIM展开
      { source: '3GPP TS 31.x', target: 'TS 31.101 终端接口' },
      { source: '3GPP TS 31.x', target: 'TS 31.102 USIM' },
      { source: '3GPP TS 31.x', target: 'TS 31.121 测试规范' },
      { source: 'ETSI TS 102.x', target: 'TS 102.221 UICC接口' },
      { source: 'GSMA SGP.x', target: 'SGP.02 M2M' },
      { source: 'GSMA SGP.x', target: 'SGP.22 Consumer' },
      { source: 'GSMA SGP.x', target: 'SGP.32 IoT' },
      { source: 'GSMA SGP.x', target: 'TCA Profile规范' },
      { source: '3GPP TS 31.x', target: 'GSMA SGP.x' },
      { source: 'ETSI TS 102.x', target: 'GSMA SGP.x' },

      // 应用管理与安全展开
      { source: 'GlobalPlatform', target: 'SCP02/03/11' },
      { source: 'GlobalPlatform', target: 'OMAPI' },
      { source: 'Java Card', target: 'JCAPI/JCVM' },
      { source: 'Common Criteria', target: 'EAL4+/EAL5+' },
      { source: 'GlobalPlatform', target: 'Java Card' },
      { source: 'Common Criteria', target: 'GlobalPlatform' },

      // 终端设备展开
      { source: '手机/移动终端', target: '3GPP TS 31.x' },
      { source: '手机/移动终端', target: 'FIDO2' },
      { source: '读卡器/IFD', target: 'PC/SC规范' },
      { source: '读卡器/IFD', target: 'USB CCID' },
      { source: 'POS/支付终端', target: 'EMV 支付' },
      { source: 'POS/支付终端', target: 'PCI PTS' },
      { source: 'POS/支付终端', target: 'EMVCo L1/L2' },
      { source: 'IoT设备', target: 'SGP.32 IoT' },
      { source: '可穿戴设备', target: 'GlobalPlatform' },

      // 行业应用与中国标准展开
      { source: 'EMV 支付', target: 'PBOC 3.0' },
      { source: 'PBOC 3.0', target: 'JR/T 0025' },
      { source: 'ISO/IEC 7816', target: 'GB/T 16649' },
      { source: '手机/移动终端', target: 'YD/T 系列' },
      { source: 'EMV 支付', target: 'POS/支付终端' },
      { source: 'ICAO 9303 电子护照', target: 'ISO/IEC 7816' },
      { source: 'Calypso 交通', target: 'ISO/IEC 14443' },
    ];

    const option: echarts.EChartsOption = {
      tooltip: {
        trigger: 'item',
        formatter(params: unknown) {
          const p = params as {
            dataType?: string;
            name?: string;
            data?: { source: string; target: string };
          };
          if (p.dataType === 'node') {
            return `规范/设备：${p.name}`;
          }
          return `${p.data?.source} → ${p.data?.target}`;
        },
      },
      legend: { show: false },
      series: [
        {
          type: 'graph',
          layout: 'force' as const,
          categories,
          data: nodes,
          links,
          itemStyle: {
            borderColor: '#fff',
            borderWidth: 2,
            shadowBlur: 5,
            shadowColor: 'rgba(0, 0, 0, 0.1)',
          },
          label: {
            show: true,
            position: 'right',
            fontSize: 12,
            color: '#333',
            formatter: '{b}',
          },
          lineStyle: {
            color: 'source',
            curveness: 0.2,
            width: 1.5,
            opacity: 0.6,
          },
          force: {
            repulsion: 1200,
            edgeLength: [100, 200],
            gravity: 0.1,
            friction: 0.1,
            layoutAnimation: true,
          },
          roam: true,
          draggable: true,
          emphasis: {
            focus: 'adjacency',
            lineStyle: { width: 3, opacity: 1 },
            label: { fontSize: 14, fontWeight: 'bold' },
          },
        },
      ],
    };

    chart.setOption(option);
  }, []);

  useEffect(() => {
    initChart();

    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.dispose();
        chartInstanceRef.current = null;
      }
    };
  }, [initChart]);

  // 窗口大小变化时自适应
  useEffect(() => {
    const handleResize = () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.resize();
      }
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <div
      ref={chartRef}
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#fafafa',
      }}
    />
  );
});
