import { BadRequestException } from '@nestjs/common';
import { validateSync } from 'class-validator';
import { IsPositiveIntegerString, PositiveIntegerPipe } from '../../src';

const invalidValues: unknown[] = [
  undefined, null, true, false, [], [1], {}, { valueOf: () => 1 }, Symbol('id'), BigInt(1),
  '', ' ', ' 1', '1 ', '+1', '-1', '0', '000', '1.0', '1.5',
  '1e3', '0x10', '0b10', '0o10', '1\n', '１２',
  '9007199254740992', '9007199254740993', '1.0000000000000001',
  0, -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1,
];

describe('PositiveIntegerPipe', () => {
  const pipe = new PositiveIntegerPipe();
  const metadata = { type: 'query' as const, data: 'page' };

  it.each([
    [1, 1], ['1', 1], ['0012', 12], [12, 12],
    [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
  ])('accepts %s and returns %s synchronously', (input, expected) => {
    expect(pipe.transform(input, metadata)).toBe(expected);
  });

  it.each(invalidValues.map(value => [value]))('rejects invalid input %# with HTTP 400', value => {
    try {
      pipe.transform(value, metadata);
      throw new Error('Expected validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(400);
    }
  });

  it('does not invoke coercion on objects', () => {
    const valueOf = jest.fn(() => { throw new Error('must not execute'); });
    expect(() => pipe.transform({ valueOf }, metadata)).toThrow(BadRequestException);
    expect(valueOf).not.toHaveBeenCalled();
  });

  it('includes the parameter name when available', () => {
    expect(() => pipe.transform('bad', metadata)).toThrow("'page' must be a positive safe integer");
  });

  it('uses a readable error when there is no parameter name', () => {
    expect(() => pipe.transform('bad', { type: 'body' })).toThrow('value must be a positive safe integer');
  });
});

describe('IsPositiveIntegerString', () => {
  class Dto {
    @IsPositiveIntegerString()
    id: unknown;
  }
  function errors(value: unknown) {
    return validateSync(Object.assign(new Dto(), { id: value }));
  }

  it.each(['1', '0012', String(Number.MAX_SAFE_INTEGER)])('accepts %s', value => {
    expect(errors(value)).toHaveLength(0);
  });

  it.each([...invalidValues, 1, Number.MAX_SAFE_INTEGER].map(value => [value]))('rejects invalid input %#', value => {
    expect(errors(value)).toHaveLength(1);
  });

  it('preserves custom validation messages', () => {
    class CustomDto {
      @IsPositiveIntegerString({ message: 'Invalid identifier' })
      id = '1e3';
    }
    const [error] = validateSync(new CustomDto());
    expect(Object.values(error.constraints!)).toEqual(['Invalid identifier']);
  });
});
