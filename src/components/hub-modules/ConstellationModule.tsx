/**
 * ConstellationModule — Wallet connection graph.
 * 5-7 pulsing nodes in constellation pattern + glowing connection lines.
 * Palette: emerald (#10b981) → cyan
 */
import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  ShaderMaterial, AdditiveBlending, BackSide,
  Mesh, Group, Color, BufferGeometry, Float32BufferAttribute,
  LineBasicMaterial,
} from 'three';
import { NOISE_GLSL, SHARED_VERT, type ModuleSceneProps } from './shared';

const FRAG_NODE = `
precision highp float;
varying vec3 vNormal;
uniform float uTime;
uniform float uPhase;
uniform vec3 uColor;
void main(){
  float pulse=sin(uTime*2.0+uPhase)*0.3+0.7;
  float fresnel=pow(1.0-abs(dot(normalize(vNormal),vec3(0,0,1))),2.0);
  vec3 col=uColor*pulse+vec3(0.5,1.0,0.9)*fresnel*1.5;
  gl_FragColor=vec4(col,0.85*pulse);
}`;

// Constellation node positions (normalized within ~0.8 radius)
const NODES: [number, number, number][] = [
  [0.0, 0.55, 0],
  [-0.45, 0.2, 0.1],
  [0.5, 0.25, -0.1],
  [-0.3, -0.3, -0.1],
  [0.35, -0.2, 0.15],
  [0.0, -0.5, 0],
  [-0.55, -0.05, 0.05],
];

// Connection pairs
const EDGES: [number, number][] = [
  [0, 1], [0, 2], [1, 3], [2, 4], [3, 5], [4, 5], [1, 6], [3, 6],
];

export default function ConstellationModule({ size, isMobile, hovered }: ModuleSceneProps) {
  const groupRef = useRef<Group>(null!);
  const nodeRef0 = useRef<Mesh>(null!);
  const nodeRef1 = useRef<Mesh>(null!);
  const nodeRef2 = useRef<Mesh>(null!);
  const nodeRef3 = useRef<Mesh>(null!);
  const nodeRef4 = useRef<Mesh>(null!);
  const nodeRef5 = useRef<Mesh>(null!);
  const nodeRef6 = useRef<Mesh>(null!);
  const nodeRefs = [nodeRef0, nodeRef1, nodeRef2, nodeRef3, nodeRef4, nodeRef5, nodeRef6];

  const nodeMats = useMemo(() =>
    NODES.map((_, i) => new ShaderMaterial({
      vertexShader: SHARED_VERT, fragmentShader: FRAG_NODE,
      uniforms: {
        uTime: { value: 0 },
        uPhase: { value: i * 0.9 },
        uColor: { value: new Color(i % 2 === 0 ? '#10b981' : '#06b6d4') },
      },
      transparent: true, depthWrite: false, blending: AdditiveBlending,
    }))
  , []);

  const lineMat = useMemo(() => new LineBasicMaterial({
    color: '#10b981', transparent: true, opacity: 0.3,
    blending: AdditiveBlending, depthWrite: false,
  }), []);

  const lineGeos = useMemo(() =>
    EDGES.map(([a, b]) => {
      const geo = new BufferGeometry();
      const positions = new Float32Array([
        ...NODES[a], ...NODES[b],
      ]);
      geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
      return geo;
    })
  , []);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    nodeMats.forEach(m => { m.uniforms.uTime.value = t; });
    if (groupRef.current) groupRef.current.rotation.y = t * 0.15;
    // Pulse node sizes
    nodeRefs.forEach((ref, i) => {
      if (ref.current) {
        const pulse = 1 + Math.sin(t * 2 + i * 0.9) * 0.15;
        ref.current.scale.setScalar(pulse);
      }
    });
    // Pulse line opacity
    lineMat.opacity = 0.2 + Math.sin(t * 1.5) * 0.1;
  });

  const s = size * (hovered ? 1.15 : 1);

  return (
    <group ref={groupRef} scale={[s, s, s]}>
      {/* Constellation nodes */}
      {NODES.map((pos, i) => (
        <mesh key={i} ref={nodeRefs[i]} position={pos} material={nodeMats[i]}>
          <sphereGeometry args={[0.06, 12, 12]} />
        </mesh>
      ))}

      {/* Connection lines */}
      {lineGeos.map((geo, i) => (
        <line key={i} geometry={geo} material={lineMat} />
      ))}

      {/* Outer glow */}
      <mesh>
        <sphereGeometry args={[1.1, 16, 16]} />
        <meshBasicMaterial color="#10b981" transparent opacity={hovered ? 0.04 : 0.012} blending={AdditiveBlending} depthWrite={false} side={BackSide} />
      </mesh>
    </group>
  );
}
