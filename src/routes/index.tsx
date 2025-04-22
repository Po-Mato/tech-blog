import React from "react";
import { Routes, Route } from "react-router-dom";
import Home from "@/pages/Home";
import Game from "@/pages/Game";
import Chat from "@/pages/Chat";

function AppRouter() {
	return (
		<Routes>
			<Route path="/" element={<Home />} />
			<Route path="/game" element={<Game />} />
			<Route path="/chat" element={<Chat />} />
		</Routes>
	);
}

export default AppRouter;
