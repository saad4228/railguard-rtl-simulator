`timescale 1ns/1ps

module railguard_controller #(
    parameter integer WARN_CYCLES = 3,
    parameter integer GATE_TIMEOUT = 5
)(
    input wire clk,
    input wire rst,
    input wire train_approach,
    input wire train_in_crossing,
    input wire gate_closed,
    input wire gate_open,

    output reg warning_light,
    output reg road_stop,
    output reg gate_close_cmd,
    output reg gate_open_cmd,
    output reg fault,
    output wire [2:0] state_debug
);

    // FSM state encoding
    localparam IDLE           = 3'd0;
    localparam WARNING        = 3'd1;
    localparam CLOSING        = 3'd2;
    localparam PASSING        = 3'd3;
    localparam OPENING        = 3'd4;
    localparam FAULT          = 3'd5;
    localparam WAIT_FOR_TRAIN = 3'd6;

    reg [2:0] state;
    reg [7:0] timer;

    // Expose the state for simulation and debugging
    assign state_debug = state;

    // Sequential logic: FSM transitions and timers
    always @(posedge clk or posedge rst) begin
        if (rst) begin
            state <= IDLE;
            timer <= 0;
        end
        else begin
            case (state)

                IDLE: begin
                    timer <= 0;

                    if (train_approach)
                        state <= WARNING;
                end

                WARNING: begin
                    if (timer >= WARN_CYCLES - 1) begin
                        timer <= 0;
                        state <= CLOSING;
                    end
                    else begin
                        timer <= timer + 1'b1;
                    end
                end

                CLOSING: begin
                    if (gate_closed) begin
                        timer <= 0;
                        state <= WAIT_FOR_TRAIN;
                    end
                    else if (timer >= GATE_TIMEOUT - 1) begin
                        timer <= 0;
                        state <= FAULT;
                    end
                    else begin
                        timer <= timer + 1'b1;
                    end
                end

                WAIT_FOR_TRAIN: begin
                    timer <= 0;

                    // The gate is already closed.
                    // Wait until the train reaches the crossing.
                    if (train_in_crossing)
                        state <= PASSING;
                end

                PASSING: begin
                    timer <= 0;

                    // Open the gate only after the train clears
                    if (!train_in_crossing)
                        state <= OPENING;
                end

                OPENING: begin
                    if (gate_open) begin
                        timer <= 0;
                        state <= IDLE;
                    end
                    else if (timer >= GATE_TIMEOUT - 1) begin
                        timer <= 0;
                        state <= FAULT;
                    end
                    else begin
                        timer <= timer + 1'b1;
                    end
                end

                FAULT: begin
                    // Remain in FAULT until reset
                    state <= FAULT;
                    timer <= 0;
                end

                default: begin
                    state <= IDLE;
                    timer <= 0;
                end

            endcase
        end
    end

    // Combinational output logic
    always @(*) begin
        warning_light = 0;
        road_stop = 0;
        gate_close_cmd = 0;
        gate_open_cmd = 0;
        fault = 0;

        case (state)

            IDLE: begin
                gate_open_cmd = 1;
            end

            WARNING: begin
                warning_light = 1;
                road_stop = 1;
                gate_open_cmd = 1;
            end

            CLOSING: begin
                warning_light = 1;
                road_stop = 1;
                gate_close_cmd = 1;
            end

            WAIT_FOR_TRAIN: begin
                warning_light = 1;
                road_stop = 1;
                gate_close_cmd = 1;
            end

            PASSING: begin
                warning_light = 1;
                road_stop = 1;
                gate_close_cmd = 1;
            end

            OPENING: begin
                warning_light = 1;
                road_stop = 1;
                gate_open_cmd = 1;
            end

            FAULT: begin
                warning_light = 1;
                road_stop = 1;
                gate_close_cmd = 1;
                fault = 1;
            end

            default: begin
                warning_light = 1;
                road_stop = 1;
                gate_close_cmd = 1;
                fault = 1;
            end

        endcase
    end

endmodule