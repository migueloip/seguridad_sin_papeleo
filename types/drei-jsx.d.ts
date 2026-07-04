import "@react-three/fiber"

declare module "@react-three/fiber" {
  interface ThreeElements {
    group: JSX.IntrinsicElements["group"]
    mesh: JSX.IntrinsicElements["mesh"]
    sphere: JSX.IntrinsicElements["sphere"]
    box: JSX.IntrinsicElements["box"]
    plane: JSX.IntrinsicElements["plane"]
    cylinder: JSX.IntrinsicElements["cylinder"]
    line: JSX.IntrinsicElements["line"]
    ambientLight: JSX.IntrinsicElements["ambientLight"]
    pointLight: JSX.IntrinsicElements["pointLight"]
    directionalLight: JSX.IntrinsicElements["directionalLight"]
    spotLight: JSX.IntrinsicElements["spotLight"]
    rectAreaLight: JSX.IntrinsicElements["rectAreaLight"]
    meshStandardMaterial: JSX.IntrinsicElements["meshStandardMaterial"]
    meshBasicMaterial: JSX.IntrinsicElements["meshBasicMaterial"]
    meshPhongMaterial: JSX.IntrinsicElements["meshPhongMaterial"]
    meshPhysicalMaterial: JSX.IntrinsicElements["meshPhysicalMaterial"]
    lineBasicMaterial: JSX.IntrinsicElements["lineBasicMaterial"]
  }
}