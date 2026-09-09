#!/usr/bin/env python3
"""
Read ICCID Skill - Python implementation

This skill reads the ICCID (Integrated Circuit Card Identifier) from a SIM card.
It follows the cross-language IPC protocol defined in the SmartCard Agent design.

Protocol:
- Reads JSON lines from stdin (Runtime→Skill messages)
- Writes JSON lines to stdout (Skill→Runtime messages)
- Writes logs to stderr
"""

import json
import sys
import os
from typing import Optional, Dict, Any

# APDU constants
CLA_ISO = 0x00
INS_GET_STATUS = 0xF2
INS_READ_BINARY = 0xB0
P1_BY_FILE = 0x00
P2_FIRST_BYTE = 0x00
SW_OK = 0x9000


class OutputSink:
    """Skill output sink for process events."""

    def __init__(self, execution_id: str):
        self.execution_id = execution_id

    def text(self, message: str):
        self._emit('TEXT', message)

    def info(self, message: str):
        self._emit('INFO', message)

    def warn(self, message: str):
        self._emit('WARN', message)

    def error(self, message: str):
        self._emit('ERROR', message)

    def data(self, data: Any):
        self._emit('DATA', '', data)

    def _emit(self, level: str, message: str, data: Any = None):
        msg = {
            'type': 'output',
            'executionId': self.execution_id,
            'level': level,
            'message': message,
        }
        if data is not None:
            msg['data'] = data
        _send_message(msg)


def _send_message(msg: Dict[str, Any]):
    """Send a Skill→Runtime message to stdout."""
    line = json.dumps(msg)
    sys.stdout.write(line + '\n')
    sys.stdout.flush()


def _read_message() -> Optional[Dict[str, Any]]:
    """Read a Runtime→Skill message from stdin."""
    line = sys.stdin.readline()
    if not line:
        return None
    return json.loads(line)


def build_apdu(cla: int, ins: int, p1: int, p2: int, data: bytes = None, le: int = None) -> Dict[str, Any]:
    """Build an APDU command dict for the runtime."""
    apdu = {
        'cla': cla,
        'ins': ins,
        'p1': p1,
        'p2': p2,
    }
    if data is not None:
        apdu['data'] = list(data)
    if le is not None:
        apdu['le'] = le
    return apdu


def parse_apdu_response(response: Dict[str, Any]) -> tuple:
    """Parse APDU response into (sw, data)."""
    sw = response.get('sw', 0)
    data = bytes(response.get('data', []))
    return sw, data


def iccid_bytes_to_string(data: bytes) -> str:
    """Convert ICCID bytes to string (BCD encoding with nibble swap)."""
    iccid = []
    for byte in data:
        # BCD decoding: swap nibbles
        high = (byte >> 4) & 0x0F
        low = byte & 0x0F
        # 0xF indicates the end (padding)
        if low == 0xF:
            if high != 0xF:
                iccid.append(str(high))
            break
        iccid.append(str(low))
        if high != 0xF:
            iccid.append(str(high))
    return ''.join(iccid)


class IccidReader:
    """SIM card ICCID reader skill."""

    def __init__(self):
        self.execution_id = None
        self.output = None

    def run(self):
        """Main loop: read messages from stdin and process them."""
        while True:
            msg = _read_message()
            if msg is None:
                break

            if msg['type'] == 'start':
                self._handle_start(msg)
            elif msg['type'] == 'action_result':
                self._handle_action_result(msg)
            elif msg['type'] == 'stop':
                break

    def _handle_start(self, msg: Dict[str, Any]):
        """Handle start message: begin ICCID reading."""
        self.execution_id = msg['executionId']
        self.output = OutputSink(self.execution_id)

        self.output.info('Starting ICCID reader skill')

        # Step 1: Send GET STATUS to select the EF.ICCID file
        # GET STATUS: CLA=0x00, INS=0xF2, P1=0x00, P2=0x00, Le=0x00
        _send_message({
            'type': 'skill_action',
            'executionId': self.execution_id,
            'action': {
                'id': 'get_status',
                'type': 'APDU',
                'name': 'GET STATUS (Select EF.ICCID)',
                'apdu': build_apdu(CLA_ISO, INS_GET_STATUS, P1_BY_FILE, P2_FIRST_BYTE, le=0x00),
            }
        })

    def _handle_action_result(self, msg: Dict[str, Any]):
        """Handle action result: process based on current step."""
        action_id = msg.get('actionId', '')

        if action_id == 'get_status':
            self._on_get_status_result(msg)
        elif action_id == 'read_binary':
            self._on_read_binary_result(msg)

    def _on_get_status_result(self, msg: Dict[str, Any]):
        """Process GET STATUS response and send READ BINARY."""
        if not msg.get('success', False):
            _send_message({
                'type': 'execution_finished',
                'executionId': self.execution_id,
                'status': 'FAILED',
                'error': 'GET STATUS failed',
            })
            return

        sw, data = parse_apdu_response(msg.get('response', {}))
        if sw != SW_OK:
            _send_message({
                'type': 'execution_finished',
                'executionId': self.execution_id,
                'status': 'FAILED',
                'error': f'GET STATUS failed with SW={sw:#06x}',
            })
            return

        self.output.info(f'GET STATUS successful, SW={sw:#06x}')

        # Step 2: Read EF.ICCID using READ BINARY
        # READ BINARY: CLA=0x00, INS=0xB0, P1=0x00, P2=0x00, Le=0x0B (11 bytes for ICCID)
        _send_message({
            'type': 'skill_action',
            'executionId': self.execution_id,
            'action': {
                'id': 'read_binary',
                'type': 'APDU',
                'name': 'READ BINARY (EF.ICCID)',
                'apdu': build_apdu(CLA_ISO, INS_READ_BINARY, P1_BY_FILE, P2_FIRST_BYTE, le=0x0B),
            }
        })

    def _on_read_binary_result(self, msg: Dict[str, Any]):
        """Process READ BINARY response and extract ICCID."""
        if not msg.get('success', False):
            _send_message({
                'type': 'execution_finished',
                'executionId': self.execution_id,
                'status': 'FAILED',
                'error': 'READ BINARY failed',
            })
            return

        sw, data = parse_apdu_response(msg.get('response', {}))
        if sw != SW_OK:
            _send_message({
                'type': 'execution_finished',
                'executionId': self.execution_id,
                'status': 'FAILED',
                'error': f'READ BINARY failed with SW={sw:#06x}',
            })
            return

        self.output.info(f'READ BINARY successful, {len(data)} bytes received')

        # Parse ICCID
        iccid = iccid_bytes_to_string(data)
        self.output.info(f'ICCID: {iccid}')
        self.output.data({'iccid': iccid, 'raw_data': data.hex()})

        # Finish successfully
        _send_message({
            'type': 'execution_finished',
            'executionId': self.execution_id,
            'status': 'SUCCESS',
            'data': {'iccid': iccid},
        })


def main():
    """Entry point: run the ICCID reader skill."""
    reader = IccidReader()
    reader.run()


if __name__ == '__main__':
    main()
