#!/usr/bin/env python3
"""
Example Sidecar Server in Python

This demonstrates how to implement a sidecar plugin in a different language.
The sidecar communicates with the PDS via HTTP/JSON-RPC.

Requirements:
    pip install flask

Usage:
    python example-sidecar-server.py
"""

from flask import Flask, request, jsonify
import time
import sys

app = Flask(__name__)

# Plugin state
plugin_state = {
    'initialized': False,
    'started': False,
    'config': {},
    'events_received': 0
}


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({'status': 'ok', 'timestamp': time.time()})


@app.route('/rpc', methods=['POST'])
def rpc():
    """Handle RPC requests from PDS"""
    try:
        message = request.json

        if not message or 'type' not in message:
            return jsonify({
                'type': 'response',
                'error': {
                    'code': -1,
                    'message': 'Invalid message format'
                }
            }), 400

        msg_type = message['type']

        if msg_type == 'request':
            method = message.get('method')
            params = message.get('params', {})

            # Handle different RPC methods
            if method == 'health':
                result = handle_health()
            elif method == 'initialize':
                result = handle_initialize(params)
            elif method == 'start':
                result = handle_start()
            elif method == 'stop':
                result = handle_stop()
            elif method == 'destroy':
                result = handle_destroy()
            else:
                return jsonify({
                    'type': 'response',
                    'id': message.get('id'),
                    'error': {
                        'code': -1,
                        'message': f'Unknown method: {method}'
                    }
                }), 400

            return jsonify({
                'type': 'response',
                'id': message.get('id'),
                'result': result
            })

        elif msg_type == 'event':
            event = message.get('event')
            data = message.get('data')
            handle_event(event, data)

            return jsonify({
                'type': 'response',
                'id': message.get('id')
            })

        else:
            return jsonify({
                'type': 'response',
                'error': {
                    'code': -1,
                    'message': f'Unsupported message type: {msg_type}'
                }
            }), 400

    except Exception as e:
        print(f'Error handling RPC: {e}', file=sys.stderr)
        return jsonify({
            'type': 'response',
            'error': {
                'code': -1,
                'message': str(e)
            }
        }), 500


def handle_health():
    """Handle health check"""
    return {
        'status': 'ok',
        'initialized': plugin_state['initialized'],
        'started': plugin_state['started'],
        'events_received': plugin_state['events_received']
    }


def handle_initialize(params):
    """Handle plugin initialization"""
    print(f'Initializing plugin with config: {params}')
    plugin_state['initialized'] = True
    plugin_state['config'] = params.get('config', {})
    return {'success': True}


def handle_start():
    """Handle plugin start"""
    print('Starting plugin')
    plugin_state['started'] = True
    return {'success': True}


def handle_stop():
    """Handle plugin stop"""
    print('Stopping plugin')
    plugin_state['started'] = False
    return {'success': True}


def handle_destroy():
    """Handle plugin destruction"""
    print('Destroying plugin')
    plugin_state['initialized'] = False
    plugin_state['started'] = False
    return {'success': True}


def handle_event(event, data):
    """Handle events from PDS"""
    plugin_state['events_received'] += 1
    print(f'Received event: {event}')
    print(f'Event data: {data}')

    # Process different event types
    if event == 'repo':
        handle_repo_event(data)
    elif event == 'account':
        handle_account_event(data)


def handle_repo_event(event_data):
    """Handle repository events"""
    if event_data.get('type') == 'commit':
        commit = event_data.get('commit', {})
        print(f"  Repository commit: {commit.get('operation')} "
              f"on {commit.get('collection')}/{commit.get('rkey')}")


def handle_account_event(event_data):
    """Handle account events"""
    print(f"  Account event: {event_data.get('type')} for {event_data.get('did')}")


if __name__ == '__main__':
    print('Starting sidecar server on port 3001')
    print('Press Ctrl+C to stop')
    app.run(host='0.0.0.0', port=3001, debug=False)
