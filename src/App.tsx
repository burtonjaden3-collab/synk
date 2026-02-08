import { HomeScreen } from "./components/home/HomeScreen";
import { Workspace } from "./components/workspace/Workspace";
import { useAppStore } from "./lib/store";

function App() {
  const currentProject = useAppStore((s) => s.currentProject);
  return currentProject ? <Workspace /> : <HomeScreen />;
}

export default App;
