import logo from './assets/brand-logo.png';

export function BrandLogo() {
  return <img className="brand-logo" src={logo} width={46} height={46} alt="蜗牛标志" draggable={false}/>;
}
