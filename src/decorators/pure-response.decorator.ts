import { SetMetadata } from '@nestjs/common';

export const PureResponse = () => {
  return SetMetadata('pureResponse', true);
};
