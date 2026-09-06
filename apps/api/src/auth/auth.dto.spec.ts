import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginDto, RegisterDto } from './auth.dto';

describe('authentication DTO validation', () => {
  it('rejects weak registration passwords', async () => {
    const dto = plainToInstance(RegisterDto, { firstName: 'Owner', lastName: 'Example', email: 'owner@example.com', phone: '1234567', password: 'weakpassword', confirmPassword: 'weakpassword' });
    const errors = await validate(dto);
    expect(errors.find((error) => error.property === 'password')).toBeDefined();
  });

  it('accepts a password meeting the registration policy', async () => {
    const dto = plainToInstance(RegisterDto, { firstName: 'Owner', lastName: 'Example', email: 'owner@example.com', phone: '1234567', password: 'StrongPass9!', confirmPassword: 'StrongPass9!' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects malformed login email', async () => {
    const errors = await validate(plainToInstance(LoginDto, { email: 'not-an-email', password: 'StrongPass9!' }));
    expect(errors.map((error) => error.property)).toContain('email');
  });
});
