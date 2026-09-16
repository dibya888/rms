import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginDto, RegisterDto } from './auth.dto';

describe('authentication DTO validation', () => {
  it('rejects weak registration passwords', async () => {
    const dto = plainToInstance(RegisterDto, { firstName: 'Owner', lastName: 'Example', email: 'owner@example.com', username: 'owner_example', phone: '1234567', password: 'weakpassword', confirmPassword: 'weakpassword' });
    const errors = await validate(dto);
    expect(errors.find((error) => error.property === 'password')).toBeDefined();
  });

  it('accepts a password meeting the registration policy', async () => {
    const dto = plainToInstance(RegisterDto, { firstName: 'Owner', lastName: 'Example', email: 'owner@example.com', username: 'owner_example', phone: '1234567', password: 'StrongPass9!', confirmPassword: 'StrongPass9!' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a registration username with disallowed characters', async () => {
    const dto = plainToInstance(RegisterDto, { firstName: 'Owner', lastName: 'Example', email: 'owner@example.com', username: 'owner example!', phone: '1234567', password: 'StrongPass9!', confirmPassword: 'StrongPass9!' });
    const errors = await validate(dto);
    expect(errors.find((error) => error.property === 'username')).toBeDefined();
  });

  it('rejects a missing login identifier', async () => {
    const errors = await validate(plainToInstance(LoginDto, { password: 'StrongPass9!' }));
    expect(errors.map((error) => error.property)).toContain('identifier');
  });

  it('accepts either an email or a plain username as the login identifier', async () => {
    expect(await validate(plainToInstance(LoginDto, { identifier: 'owner@example.com', password: 'StrongPass9!' }))).toHaveLength(0);
    expect(await validate(plainToInstance(LoginDto, { identifier: 'owner_example', password: 'StrongPass9!' }))).toHaveLength(0);
  });
});
