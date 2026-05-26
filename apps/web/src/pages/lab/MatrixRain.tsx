import LabFrame from './LabFrame';
import MatrixCanvas from '../../components/MatrixCanvas';

export default function MatrixRain() {
  return (
    <LabFrame
      slug="matrix"
      title="matrix-rain"
      desc="Cyberdeck 标配。canvas 2d + glow + 半透明拖尾。"
      accent="green"
    >
      <MatrixCanvas className="w-full h-[480px] block bg-terminal-bg" />
    </LabFrame>
  );
}
