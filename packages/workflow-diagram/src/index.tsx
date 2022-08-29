import { toElkNode, toFlow } from "./layout";
import React, { useEffect } from "react";
import ReactFlow, { useEdgesState, useNodesState } from "react-flow-renderer";
import JobNode from "./nodes/JobNode";
import TriggerNode from "./nodes/TriggerNode";
import AddNode from "./nodes/AddNode";
import OperationNode from "./nodes/OperationNode";
import type { ProjectSpace } from "./types";

import "./main.css";

const nodeTypes = {
  job: JobNode,
  add: AddNode,
  operation: OperationNode,
  trigger: TriggerNode,
};

const WorkflowDiagram: React.FC<{
  projectSpace: ProjectSpace;
  onNodeClick?: (event: React.MouseEvent, {}) => void;
  onPaneClick?: (event: React.MouseEvent) => void;
}> = ({ projectSpace, onNodeClick, onPaneClick }) => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  useEffect(() => {
    const elkNodes = toElkNode(projectSpace);

    toFlow(elkNodes).then(({ nodes, edges }) => {
      setNodes(nodes);
      setEdges(edges);
    });
  }, []);

  return (
    <ReactFlow
      // Thank you, Christopher Möller, for explaining that we can use this...
      proOptions={{ account: "paid-pro", hideAttribution: true }}
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      // onConnect={onConnect}
      // If we let folks drag, we have to save new visual configuration...
      nodesDraggable={false}
      // No interaction for this yet...
      nodesConnectable={false}
      nodeTypes={nodeTypes}
      snapToGrid={true}
      snapGrid={[10, 10]}
      onNodeClick={onNodeClick}
      onPaneClick={onPaneClick}
      fitView
    />
  );
};

export default WorkflowDiagram;
