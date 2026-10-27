import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Cliente } from '../entities/cliente.entity';
import { CreateClienteDto } from './dto/create-cliente.dto';
import { UpdateClienteDto } from './dto/update-cliente.dto';
import { GeoService } from '../geo/geo.service';

@Injectable()
export class ClientesService {
  constructor(
    @InjectRepository(Cliente)
    private readonly repo: Repository<Cliente>,
    private readonly geo: GeoService,
  ) {}

  findAll() {
    return this.repo.find({ order: { nome: 'ASC' } });
  }

  async findOne(id: string) {
    const c = await this.repo.findOne({ where: { id } });
    if (!c) throw new NotFoundException('Cliente não encontrado.');
    return c;
  }

  /**
   * Cria o cliente. Se lat/lng não vierem no DTO, tenta geocodificar o endereço.
   * Um cliente sem coordenadas gera pedidos que ficam de fora da otimização de
   * rota (vão para o fim da sequência), então vale conferir o resultado.
   */
  async create(dto: CreateClienteDto) {
    let lat = dto.lat ?? null;
    let lng = dto.lng ?? null;
    let encontrado: string | undefined;

    if (lat == null || lng == null) {
      const coord = await this.geo.geocodificar(dto.endereco);
      if (coord) {
        lat = coord.lat;
        lng = coord.lng;
        encontrado = coord.endereco;
      }
    }

    const cliente = this.repo.create({
      nome: dto.nome,
      telefone: dto.telefone ?? null,
      endereco: dto.endereco,
      lat: lat != null ? String(lat) : null,
      lng: lng != null ? String(lng) : null,
      referencia: dto.referencia ?? null,
    });
    const salvo = await this.repo.save(cliente);

    // `encontrado` não é persistido: serve para a tela mostrar ao atendente o que
    // o geocodificador entendeu, para ele conferir se é mesmo o endereço certo.
    return { ...salvo, geocodificado_como: encontrado ?? null };
  }

  /**
   * Edita o cliente.
   *
   * Regra do endereço: se ele mudar e o front NÃO mandar lat/lng, regeocodifica.
   * Sem isso, corrigir um endereço errado deixaria a coordenada velha (errada)
   * grudada no cliente — que é a pior combinação possível: endereço certo na
   * tela, ponto errado no mapa.
   */
  async update(id: string, dto: UpdateClienteDto) {
    const cliente = await this.findOne(id);
    const enderecoMudou =
      dto.endereco !== undefined && dto.endereco !== cliente.endereco;

    if (dto.nome !== undefined) cliente.nome = dto.nome;
    if (dto.telefone !== undefined) cliente.telefone = dto.telefone || null;
    if (dto.endereco !== undefined) cliente.endereco = dto.endereco;
    if (dto.referencia !== undefined) cliente.referencia = dto.referencia || null;

    let encontrado: string | undefined;

    if (dto.lat != null && dto.lng != null) {
      cliente.lat = String(dto.lat);
      cliente.lng = String(dto.lng);
    } else if (enderecoMudou) {
      const coord = await this.geo.geocodificar(cliente.endereco);
      cliente.lat = coord ? String(coord.lat) : null;
      cliente.lng = coord ? String(coord.lng) : null;
      encontrado = coord?.endereco;
    }

    const salvo = await this.repo.save(cliente);
    return { ...salvo, geocodificado_como: encontrado ?? null };
  }

  /** Corrige só as coordenadas (ex.: o atendente arrastou o pino no mapa). */
  async atualizarCoordenadas(id: string, lat: number, lng: number) {
    const cliente = await this.findOne(id);
    cliente.lat = String(lat);
    cliente.lng = String(lng);
    return this.repo.save(cliente);
  }

  /**
   * Geocodifica os clientes que ficaram sem coordenadas (cadastrados antes de a
   * geocodificação existir, ou quando o provedor estava fora do ar).
   * O GeoService serializa as chamadas em 1/s no Nominatim, então isto é lento
   * de propósito: com 60 clientes pendentes, leva ~1 minuto.
   */
  async geocodificarPendentes() {
    const pendentes = await this.repo.find({
      where: [{ lat: IsNull() }, { lng: IsNull() }],
    });

    let resolvidos = 0;
    const falhas: Array<{ id: string; nome: string; endereco: string }> = [];

    for (const cliente of pendentes) {
      const coord = await this.geo.geocodificar(cliente.endereco);
      if (!coord) {
        falhas.push({
          id: cliente.id,
          nome: cliente.nome,
          endereco: cliente.endereco,
        });
        continue;
      }
      cliente.lat = String(coord.lat);
      cliente.lng = String(coord.lng);
      await this.repo.save(cliente);
      resolvidos++;
    }

    return { pendentes: pendentes.length, resolvidos, falhas };
  }
}
