// A stand-in for the control socket of a Kea daemon, for test/ucode/runtime.uc.
//
//   ucode control-server.uc PATH reply    answer one command like Kea does
//   ucode control-server.uc PATH silent   take one command and say nothing
//
// It serves one connection and removes its socket.

'use strict';

import * as socket from 'socket';
import * as fs from 'fs';

const path = ARGV[0];
const server = socket.create(socket.AF_UNIX, socket.SOCK_STREAM);

if (!server || !server.bind({ path }) || !server.listen())
	exit(1);

socket.poll(5000, server);

const conn = server.accept();

if (conn) {
	socket.poll(2000, conn);

	const request = json(conn.recv(4096));

	if (ARGV[1] == 'silent')
		socket.poll(4000, [ conn, socket.POLLHUP ]);
	else
		conn.send(sprintf('%J', {
			result: 0,
			arguments: { command: request.command, sockets: { status: 'ready' } }
		}));

	conn.close();
}

server.close();
fs.unlink(path);
