import React from "react";
import AppRouter from "@/routes";
import NavigationBar from "@/components/NavigationBar";
import "./App.scss";

function App() {
	return (
		<>
			<NavigationBar />
			<AppRouter />
		</>
	);
}

export default App;
