import { SetMetadata } from '@nestjs/common';

export const PureResponse = (enabled = true) => {
  return SetMetadata('pureResponse', enabled);
};
