/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '../config/config.js';
import { ToolNames } from '../tools/tool-names.js';

/**
 * Injected into the system prompt while the knowledge retrieval tool is
 * available. It describes what the knowledge base covers (so the model can
 * judge when to consult it) and, more importantly, constrains HOW to retrieve:
 * through the built-in tool rather than a shell/script HTTP call. It does not
 * tell the model WHEN to retrieve — that classification stays with the model.
 */
const KNOWLEDGE_RETRIEVAL_GUIDANCE = `
# Knowledge retrieval

本知识库面向智能卡、eSIM/eUICC、可信平台、数字身份、支付及信息安全等技术领域，主要收录相关国际标准、行业规范、技术协议和安全认证文档。

知识库按以下六个领域组织：
- 基础标准（01-foundation）：ISO/IEC、NFC Forum 等基础技术标准。
- 平台技术（02-platform）：ETSI/3GPP、GlobalPlatform、Java Card 等平台及运行环境规范。
- 管理与配置（03-management-provisioning）：GSMA、ETSI/3GPP、GlobalPlatform 等涉及 eSIM/eUICC、远程配置、生命周期管理及应用隔离的规范。
- 行业应用（04-applications）：EMVCo、FIDO、ICAO、Calypso 等支付、身份认证及行业应用规范。
- 安全与认证（05-security-certification）：Common Criteria、ISO/IEC、NIST、PCI SSC、SESIP 等安全标准与认证规范。
- 支撑性技术（06-supporting）：IETF、ITU-T、GM/T、ISO/IEC、NIST 等通用协议与技术标准。

如果需要调用知识检索，则必须使用 \`${ToolNames.KNOWLEDGE_RETRIEVAL}\` 工具；不要用 shell、python 或其他方式直接调用检索 HTTP 接口。
`;

/**
 * Builds the knowledge retrieval system-prompt section, or returns null when
 * the feature is not active. Active means the service URL is configured AND
 * the tool is not disabled: injecting guidance while the tool is absent would
 * steer the model toward a tool it cannot call.
 */
export function buildKnowledgeGuidanceSection(config: Config): string | null {
  if (!config.getKnowledgeRetrievalSettings()) return null;
  if (config.getDisabledTools().has(ToolNames.KNOWLEDGE_RETRIEVAL)) {
    return null;
  }
  return KNOWLEDGE_RETRIEVAL_GUIDANCE;
}
