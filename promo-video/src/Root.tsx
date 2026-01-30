import "./index.css";
import { Composition } from "remotion";
import { DemoComposition } from "./DemoComposition";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="PromoDemo"
        component={DemoComposition}
        durationInFrames={360}
        fps={30}
        width={1280}
        height={720}
      />
    </>
  );
};
