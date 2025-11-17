FROM public.ecr.aws/lambda/nodejs:20

WORKDIR /var/task

COPY package*.json ./
RUN npm ci --only=production

# Copiar solo lo necesario para la Lambda basada en el servicio compartido
COPY src ./src
COPY lambda ./lambda

# TODO: Agrega cualquier archivo de configuración adicional que necesites para la Lambda
CMD ["lambda/handler.handler"]
